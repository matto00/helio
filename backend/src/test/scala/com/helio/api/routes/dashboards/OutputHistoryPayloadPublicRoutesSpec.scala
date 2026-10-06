package com.helio.api.routes.dashboards

import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.NodePayloadFixtures
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1276 task 6.7: public dashboards NEVER receive payloads. For an Output that has a stored payload
 *  on a publicly shared dashboard: the public history points carry no id/hasPayload/payloadId/rows
 *  key, and the public route tree does not handle a payload path at all. (The full-`ApiRoutes` 401 is
 *  in `NodePayloadWiringSpec`.) */
class OutputHistoryPayloadPublicRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with NodePayloadFixtures {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var ownerId: String = _

  override def beforeAll(): Unit = { super.beforeAll(); startHarness(); ownerId = seedUser("beta") }
  override def afterAll(): Unit  = { stopHarness(); super.afterAll() }

  private def routes(): Route =
    new PublicDashboardRoutes(
      panelRepo, aclDirective, userOpt = None, Some(outputRepo), Some(pipelineRepo), Some(snapshotRepo), None, Some(historyService)
    )(typedSystem).routes

  /** A public dashboard with an Output panel bound to an opted-in Output whose real run stored a payload. */
  private def seedPublicWithPayload(): (String, String, String, String) = {
    val fx = seedPayloadPipeline(ownerId)
    awaitDb(runService().submit(fx.pid, isDry = false, AuthenticatedUser(UserId(ownerId)))) shouldBe a[Right[_, _]]
    payloadLinks(fx.optedOutput).flatten should have size 1
    val dashId  = UUID.randomUUID().toString
    val panelId = UUID.randomUUID().toString
    awaitDb(db.run(DBIO.seq(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($dashId, 'Dash', $ownerId, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)""",
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashId, NULL, 'viewer', now())""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
             VALUES ($panelId, $dashId, 'P', $ownerId, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}',
                     'output', ${fx.optedOutput}, ${ownerId}::uuid)"""
    )))
    (dashId, panelId, fx.optedOutput, payloadLinks(fx.optedOutput).flatten.head)
  }

  "the public history of an Output with a stored payload" should {
    "carry no id, hasPayload, payloadId or rows key on any point, and leak neither the point id nor the payload id" in {
      val (dashId, panelId, _, payloadId) = seedPublicWithPayload()
      val pointId = awaitDb(db.run(sql"SELECT id::text FROM output_snapshot_history WHERE payload_id = $payloadId::uuid".as[String].head))
      Get(s"/dashboards/$dashId/panels/$panelId/history") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val raw    = responseAs[String]
        val points = raw.parseJson.asJsObject.fields("points").convertTo[Vector[JsObject]]
        points should have size 1
        points.head.fields.keySet shouldBe Set("capturedAt", "rowCount", "summary")
        Seq("id", "hasPayload", "payloadId", "rows").foreach(k => points.head.fields.keySet should not contain k)
        raw should not include pointId
        raw should not include payloadId
      }
    }
  }

  "the public route tree" should {
    "not handle a payload path under a panel's history, for a real point id (with or without a token)" in {
      val (dashId, panelId, _, payloadId) = seedPublicWithPayload()
      val pointId = awaitDb(db.run(sql"SELECT id::text FROM output_snapshot_history WHERE payload_id = $payloadId::uuid".as[String].head))
      Seq("", "?token=anything").foreach { q =>
        Get(s"/dashboards/$dashId/panels/$panelId/history/$pointId/rows$q") ~> routes() ~> check {
          handled shouldBe false
        }
      }
    }
  }
}
