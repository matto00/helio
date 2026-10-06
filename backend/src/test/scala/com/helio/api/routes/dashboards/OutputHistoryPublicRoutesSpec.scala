package com.helio.api.routes.dashboards

import com.helio.api.JsonProtocols
import com.helio.domain.model.OutputId
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{JsonSchemaValidation, OutputHistoryApiHarness}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1273: `GET /dashboards/:dashboardId/panels/:panelId/history` -- the public, allow-listed
 *  variant. Asserted field by field against an explicit allowlist, with leak markers for values a
 *  key check alone would not catch, and the dashboard/panel/Output gate failures all `404`. */
class OutputHistoryPublicRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with OutputHistoryApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var ownerId: String = _

  override def beforeAll(): Unit = { super.beforeAll(); startHarness(); ownerId = seedUser() }
  override def afterAll(): Unit  = { stopHarness(); super.afterAll() }

  private def routes(): Route =
    new PublicDashboardRoutes(
      panelRepo, aclDirective, userOpt = None, outputRepo, Some(pipelineRepo), Some(snapshotRepo), None, Some(historyService)
    )(typedSystem).routes

  private val T: Instant = Instant.now().minus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MILLIS)
  private def daysBefore(d: Long): Instant = T.minus(d, ChronoUnit.DAYS)

  private def seedDashboard(public: Boolean): String = {
    val id = UUID.randomUUID().toString
    awaitDb(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($id, 'Dash', $ownerId, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}',
                       '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
    ))
    if (public)
      awaitDb(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                            VALUES ('dashboard', $id, NULL, 'viewer', now())"""))
    id
  }

  private def seedPanel(dashId: String, outputId: Option[String], kind: String = "output"): String = {
    val panelId = UUID.randomUUID().toString
    awaitDb(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
               VALUES ($panelId, $dashId, 'P', $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       $kind, ${outputId}, ${ownerId}::uuid)"""
    ))
    panelId
  }

  /** Output with the D6 window fixture (T-9d, T-8d, T-6d, T), bound to a panel on a public dashboard. */
  private def seedBoundFixture(): (String, String, String, String, String) = {
    val dashId     = seedDashboard(public = true)
    val (pid, oid) = seedMetricOutput(ownerId, Some("7d"))
    val runIds     = Seq(9L, 8L, 6L, 0L).map { d =>
      val rid = UUID.randomUUID().toString
      awaitDb(db.run(historyRepo.insertAction(Seq(historyEntry(oid, pid, daysBefore(d), rid).copy(summary = summaryOf(Some(100.0 - d)))))))
      rid
    }
    (dashId, seedPanel(dashId, Some(oid)), oid, pid, runIds.head)
  }

  private val topKeys   = Set("compare", "current", "baseline", "delta", "pct", "availableFrom", "sparkline", "points")
  private val schema    = JsonSchemaValidation.compile("outputs/public-output-history-response.schema.json")

  "GET /dashboards/:d/panels/:p/history" should {
    "return EXACTLY the allowlisted keys for an anonymous caller and leak no id, run id or trigger source" in {
      val (dashId, panelId, oid, pid, runId) = seedBoundFixture()
      Get(s"/dashboards/$dashId/panels/$panelId/history") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val raw  = responseAs[String]
        val body = raw.parseJson.asJsObject
        body.fields.keySet shouldBe topKeys
        val points = body.fields("points").convertTo[Vector[JsObject]]
        points.size shouldBe 4
        points.map(_.fields.keySet).toSet shouldBe Set(Set("capturedAt", "rowCount", "summary"))
        val forbidden = Seq("runId", "triggerSource", "ownerId", "outputId", "pipelineId", oid, pid, ownerId, runId)
        forbidden.foreach(f => withClue(s"leak marker '$f': ")(raw should not include f))
        JsonSchemaValidation.validationErrors(schema, raw) shouldBe Vector.empty
      }
    }

    "carry series on resolved points and still leak no id, payload flag, run id or trigger source" in {
      val dashId     = seedDashboard(public = true)
      val (pid, oid) = seedMetricOutput(ownerId, Some("7d"))
      addPointWithSummary(oid, pid, daysBefore(8), seriesSummary(Seq(1, 2)))
      addPointWithSummary(oid, pid, T, seriesSummary(Seq(3, 4)))
      val panelId = seedPanel(dashId, Some(oid))
      Get(s"/dashboards/$dashId/panels/$panelId/history") ~> routes() ~> check {
        val raw  = responseAs[String]
        val body = raw.parseJson.asJsObject
        body.fields("baseline").asJsObject.fields("series").asJsObject.fields("y") shouldBe JsString("amount")
        body.fields("current").asJsObject.fields("series").asJsObject.fields("points").convertTo[Vector[JsValue]].size shouldBe 2
        Seq("\"id\"", "hasPayload", "runId", "triggerSource").foreach(k => withClue(s"key '$k': ")(raw should not include k))
        JsonSchemaValidation.validationErrors(schema, raw) shouldBe Vector.empty
      }
    }

    "resolve the same comparison as the authenticated route (baseline T-8d, delta, pct)" in {
      val (dashId, panelId, _, _, _) = seedBoundFixture()
      Get(s"/dashboards/$dashId/panels/$panelId/history") ~> routes() ~> check {
        val body = responseAs[JsObject]
        body.fields("baseline").asJsObject.fields("capturedAt") shouldBe JsString(daysBefore(8).toString)
        body.fields("delta") shouldBe JsNumber(8)
        body.fields("compare") shouldBe JsString("7d")
      }
    }

    "honour limit/since and 400 malformed ones exactly like the authenticated route" in {
      val (dashId, panelId, _, _, _) = seedBoundFixture()
      Get(s"/dashboards/$dashId/panels/$panelId/history?limit=1") ~> routes() ~> check {
        responseAs[JsObject].fields("points").convertTo[Vector[JsValue]].size shouldBe 1
      }
      Seq("?limit=0", "?limit=101", "?limit=x", "?since=nope").foreach { q =>
        Get(s"/dashboards/$dashId/panels/$panelId/history$q") ~> routes() ~> check { status shouldBe StatusCodes.BadRequest }
      }
    }

    "404 a private dashboard, another dashboard's panel, a non-output (unbound) panel, a deleted Output and a missing panel" in {
      val (dashId, panelId, oid, _, _) = seedBoundFixture()
      val privateDash                  = seedDashboard(public = false)
      val privatePanel                 = seedPanel(privateDash, Some(oid))
      val otherDash                    = seedDashboard(public = true)
      val text                         = seedPanel(dashId, None, kind = "text")
      Get(s"/dashboards/$privateDash/panels/$privatePanel/history") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
      Get(s"/dashboards/$otherDash/panels/$panelId/history") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
      Get(s"/dashboards/$dashId/panels/$text/history") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
      Get(s"/dashboards/$dashId/panels/${UUID.randomUUID()}/history") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
      Get(s"/dashboards/$dashId/panels/$panelId/history") ~> routes() ~> check { status shouldBe StatusCodes.OK }
      awaitDb(outputRepo.deleteInternal(OutputId(oid)))
      Get(s"/dashboards/$dashId/panels/$panelId/history") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
    }
  }
}
