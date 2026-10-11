package com.helio.infrastructure.persistence.panels

import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.io.Source

/** HEL-1456 V123: the one-off repair of ghost layout items that predate V122. The chain runs as a genuine
 *  NOSUPERUSER / NOBYPASSRLS table-owning role (the production `helio`), which under FORCE ROW LEVEL SECURITY with
 *  no user GUC sees ZERO panels: a repair that read panels as that role would treat every item as a ghost and wipe
 *  the live ones, so the live-item assertions below are the proof the repair really reads past RLS. Ghosts are
 *  seeded at V121, where nothing strips them. */
class V123StripExistingGhostLayoutItemsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with LayoutStripDbSupport {

  private val owner = newId()
  private val ghost = newId()

  private var multi: String              = _
  private var allGhost: String           = _
  private var clean: String              = _
  private var noPanels: String           = _
  private var odd: String                = _
  private var multiLive: Vector[String]  = _
  private var multiBefore: JsObject      = _
  private var cleanVersion: String       = _

  override def beforeAll(): Unit = {
    startPostgres()
    flyway(Some("121")).migrate()
    val su = superConn()
    try {
      seedUser(su, owner)
      multi = newId(); multiLive = Vector.fill(3)(newId())
      multiBefore = layout(Vector(multiLive(0), ghost, multiLive(1), newId(), multiLive(2)))
      seedDashboard(su, multi, owner, multiBefore)
      multiLive.foreach(seedPanel(su, _, multi, owner))

      allGhost = newId(); seedDashboard(su, allGhost, owner, layout(Vector(ghost, newId())))
      clean = newId(); val cleanPanel = newId()
      seedDashboard(su, clean, owner, layout(Vector(cleanPanel))); seedPanel(su, cleanPanel, clean, owner)
      noPanels = newId(); seedDashboard(su, noPanels, owner, layout(Vector(ghost)))
      // A panel id that exists, but on ANOTHER dashboard, is a ghost here.
      val elsewhere = newId(); seedPanel(su, elsewhere, multi, owner)
      odd = newId()
      val oddBefore = JsObject("lg" -> JsArray(item(elsewhere, 0), JsString("not-an-item"), JsObject("x" -> JsNumber(1))), "md" -> JsString("oops"), "xs" -> JsNull).compactPrint
      exec(su, s"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
                  |VALUES ('$odd', 'odd', '$owner', now(), '2026-01-02T03:04:05Z', '{}'::jsonb, '$oddBefore'::jsonb, '$owner'::uuid)""".stripMargin)
      cleanVersion = rowVersion(su, clean)
    } finally su.close()
    flyway(Some("123")).migrate()
  }

  override def afterAll(): Unit = { pg.close(); super.afterAll() }

  private def stored(id: String): JsValue = { val su = superConn(); try storedLayout(su, id) finally su.close() }

  "V123, run as a NOBYPASSRLS table-owning role" should {
    "strip ghosts from every breakpoint and leave every live item byte-identical and in order" in {
      val after = stored(multi)
      val live = multiLive.toSet
      Bps.foreach { bp =>
        after.asJsObject.fields(bp).convertTo[Vector[JsObject]] shouldBe
          multiBefore.fields(bp).convertTo[Vector[JsObject]].filter(i => live(i.fields("panelId").convertTo[String]))
      }
      Bps.foreach(bp => panelIdsIn(after, bp) shouldBe multiLive)
    }

    "leave an empty array, never null, when every item was a ghost, and strip a dashboard with no panels" in {
      stored(allGhost) shouldBe JsObject(Bps.map(_ -> JsArray()).toMap)
      stored(noPanels) shouldBe JsObject(Bps.map(_ -> JsArray()).toMap)
    }

    "not write a dashboard with nothing to strip" in {
      val su = superConn()
      try rowVersion(su, clean) shouldBe cleanVersion finally su.close()
    }

    "strip an id that is a panel of another dashboard, keeping unaddressable elements and non-array breakpoints" in {
      stored(odd) shouldBe JsObject("lg" -> JsArray(JsString("not-an-item"), JsObject("x" -> JsNumber(1))), "md" -> JsString("oops"), "xs" -> JsNull)
    }

    "not touch last_updated" in {
      val su = superConn()
      try rows(su, s"SELECT last_updated = '2026-01-02T03:04:05Z'::timestamptz FROM dashboards WHERE id = '$multi'")(_.getBoolean(1)) shouldBe Vector(true)
      finally su.close()
    }

    "be idempotent: running the migration's SQL again writes nothing" in {
      val su = superConn()
      val versions = try Vector(multi, allGhost, clean, noPanels, odd).map(id => id -> rowVersion(su, id)).toMap finally su.close()
      val sql = { val s = Source.fromResource("db/migration/V123__strip_existing_ghost_layout_items.sql"); try s.mkString finally s.close() }
      val app = appConn(owner)
      try exec(app, sql) finally app.close()
      val su2 = superConn()
      try versions.foreach { case (id, v) => rowVersion(su2, id) shouldBe v } finally su2.close()
    }

    "leave no helper function behind" in {
      val su = superConn()
      try rows(su, "SELECT count(*) FROM pg_proc WHERE proname = 'hel1456_repair_ghost_layout_items'")(_.getInt(1)) shouldBe Vector(0)
      finally su.close()
    }
  }
}
