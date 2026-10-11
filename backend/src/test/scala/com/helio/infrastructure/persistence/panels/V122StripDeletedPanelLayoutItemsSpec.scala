package com.helio.infrastructure.persistence.panels

import org.postgresql.util.PSQLException
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.sql.Connection

/** HEL-1456 V122: deleting a panel row, by any statement, strips its items from every breakpoint of its
 *  dashboard's stored layout. Every delete below runs as the NOSUPERUSER / NOBYPASSRLS schema owner with the RLS
 *  user GUC set (the production shape); seeding and read-backs use the superuser connection. */
class V122StripDeletedPanelLayoutItemsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with LayoutStripDbSupport {

  private val userA = newId()
  private val userB = newId()

  override def beforeAll(): Unit = {
    startPostgres()
    flyway(None).migrate()
    val su = superConn()
    try { seedUser(su, userA); seedUser(su, userB) } finally su.close()
  }

  override def afterAll(): Unit = { pg.close(); super.afterAll() }

  private case class Fixture(dashboardId: String, panelIds: Vector[String])

  private def dashboardWithPanels(owner: String, n: Int, outputId: Option[String] = None): Fixture = {
    val su = superConn()
    try {
      val ids = Vector.fill(n)(newId())
      val did = newId()
      seedDashboard(su, did, owner, layout(ids))
      ids.foreach(seedPanel(su, _, did, owner, outputId))
      Fixture(did, ids)
    } finally su.close()
  }

  private def asUser[T](user: String)(f: Connection => T): T = {
    val c = appConn(user)
    try f(c) finally c.close()
  }

  private def stored(did: String): JsValue = { val su = superConn(); try storedLayout(su, did) finally su.close() }

  "deleting one panel" should {
    "remove its item from lg, md, sm and xs and keep the others unchanged and in order" in {
      val fx     = dashboardWithPanels(userA, 3)
      val before = layout(fx.panelIds)
      asUser(userA)(exec(_, s"DELETE FROM panels WHERE id = '${fx.panelIds(1)}'")) shouldBe 1
      val after = stored(fx.dashboardId)
      Bps.foreach { bp =>
        panelIdsIn(after, bp) shouldBe Vector(fx.panelIds(0), fx.panelIds(2))
        val b = before.fields(bp).convertTo[Vector[JsObject]]
        after.asJsObject.fields(bp).convertTo[Vector[JsObject]] shouldBe Vector(b(0), b(2))
      }
    }

    "leave an empty array, never null, in a breakpoint emptied by the delete" in {
      val fx = dashboardWithPanels(userA, 1)
      asUser(userA)(exec(_, s"DELETE FROM panels WHERE id = '${fx.panelIds.head}'"))
      stored(fx.dashboardId) shouldBe JsObject(Bps.map(_ -> JsArray()).toMap)
    }

    "not write the dashboard row when the panel has no item, and not bump last_updated" in {
      val fx = dashboardWithPanels(userA, 2)
      val su = superConn()
      try {
        exec(su, s"UPDATE dashboards SET layout = '${layout(Vector(fx.panelIds(0))).compactPrint}'::jsonb WHERE id = '${fx.dashboardId}'")
        val before = rowVersion(su, fx.dashboardId)
        asUser(userA)(exec(_, s"DELETE FROM panels WHERE id = '${fx.panelIds(1)}'"))
        rowVersion(su, fx.dashboardId) shouldBe before
      } finally su.close()
    }

    "bump nothing but the layout when it does strip" in {
      val fx = dashboardWithPanels(userA, 2)
      val su = superConn()
      try {
        val lastUpdated = rows(su, s"SELECT last_updated::text FROM dashboards WHERE id = '${fx.dashboardId}'")(_.getString(1))
        asUser(userA)(exec(_, s"DELETE FROM panels WHERE id = '${fx.panelIds(0)}'"))
        rows(su, s"SELECT last_updated::text FROM dashboards WHERE id = '${fx.dashboardId}'")(_.getString(1)) shouldBe lastUpdated
      } finally su.close()
    }

    "keep non-array breakpoints and unknown keys as stored" in {
      val fx = dashboardWithPanels(userA, 2)
      val odd = JsObject("lg" -> JsArray(item(fx.panelIds(0), 0), item(fx.panelIds(1), 5)), "md" -> JsString("oops"), "sm" -> JsNull, "extra" -> JsArray(JsString("x")))
      val su  = superConn()
      try exec(su, s"UPDATE dashboards SET layout = '${odd.compactPrint}'::jsonb WHERE id = '${fx.dashboardId}'") finally su.close()
      asUser(userA)(exec(_, s"DELETE FROM panels WHERE id = '${fx.panelIds(1)}'"))
      stored(fx.dashboardId) shouldBe JsObject("lg" -> JsArray(item(fx.panelIds(0), 0)), "md" -> JsString("oops"), "sm" -> JsNull, "extra" -> JsArray(JsString("x")))
    }
  }

  "a bulk delete statement" should {
    "strip every affected dashboard, each exactly once" in {
      val su         = superConn()
      val (_, output) = try seedPipelineWithOutput(su, userA) finally su.close()
      val d1 = dashboardWithPanels(userA, 2, Some(output))
      val d2 = dashboardWithPanels(userA, 3, Some(output))
      asUser(userA)(exec(_, s"DELETE FROM panels WHERE output_id = '$output'")) shouldBe 5
      Seq(d1, d2).foreach(fx => Bps.foreach(bp => panelIdsIn(stored(fx.dashboardId), bp) shouldBe empty))
    }
  }

  "a database cascade" should {
    "strip the panels removed by an Output delete" in {
      val su = superConn()
      val (_, output) = try seedPipelineWithOutput(su, userA) finally su.close()
      val live = dashboardWithPanels(userA, 1)
      val fx   = dashboardWithPanels(userA, 2, Some(output))
      asUser(userA)(exec(_, s"DELETE FROM outputs WHERE id = '$output'"))
      Bps.foreach(bp => panelIdsIn(stored(fx.dashboardId), bp) shouldBe empty)
      stored(live.dashboardId) shouldBe layout(live.panelIds)
    }

    "strip the panels removed by a pipeline delete" in {
      val su = superConn()
      val (pipeline, output) = try seedPipelineWithOutput(su, userA) finally su.close()
      val fx = dashboardWithPanels(userA, 2, Some(output))
      asUser(userA)(exec(_, s"DELETE FROM pipelines WHERE id = '$pipeline'"))
      Bps.foreach(bp => panelIdsIn(stored(fx.dashboardId), bp) shouldBe empty)
    }

    "strip a dashboard the deleting user cannot update, by re-owning the function to the BYPASSRLS helio_privileged" in {
      val su = superConn()
      val (_, output) = try seedPipelineWithOutput(su, userB) finally su.close()
      val victim = dashboardWithPanels(userA, 2, Some(output))
      withClue("precondition, user B cannot write user A's dashboard: ") {
        asUser(userB)(exec(_, s"UPDATE dashboards SET layout = '{}'::jsonb WHERE id = '${victim.dashboardId}'")) shouldBe 0
      }
      asUser(userB)(exec(_, s"DELETE FROM outputs WHERE id = '$output'"))
      Bps.foreach(bp => panelIdsIn(stored(victim.dashboardId), bp) shouldBe empty)
    }

    "fail loudly (42501), not silently, if the function loses its helio_privileged ownership" in {
      val su = superConn()
      val (_, output) = try seedPipelineWithOutput(su, userB) finally su.close()
      val victim = dashboardWithPanels(userA, 1, Some(output))
      val admin  = superConn()
      try {
        exec(admin, s"ALTER FUNCTION hel1456_strip_deleted_panel_layout_items() OWNER TO $AppRole")
        try {
          val thrown = intercept[PSQLException](asUser(userB)(exec(_, s"DELETE FROM outputs WHERE id = '$output'")))
          thrown.getSQLState shouldBe "42501"
        } finally exec(admin, "ALTER FUNCTION hel1456_strip_deleted_panel_layout_items() OWNER TO helio_privileged")
        panelIdsIn(stored(victim.dashboardId), "lg") shouldBe victim.panelIds
      } finally admin.close()
    }
  }

  "deleting a dashboard" should {
    "still succeed, taking its panels with it" in {
      val fx = dashboardWithPanels(userA, 2)
      asUser(userA)(exec(_, s"DELETE FROM dashboards WHERE id = '${fx.dashboardId}'")) shouldBe 1
      val su = superConn()
      try rows(su, s"SELECT count(*) FROM panels WHERE dashboard_id = '${fx.dashboardId}'")(_.getInt(1)) shouldBe Vector(0)
      finally su.close()
    }
  }
}
