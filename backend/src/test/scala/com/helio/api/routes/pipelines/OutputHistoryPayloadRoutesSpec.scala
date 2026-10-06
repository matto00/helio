package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{JsonSchemaValidation, NodePayloadFixtures}
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
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1276 task 6.6: `GET /api/outputs/:id/history/:point/rows` -- reachable from the ids the
 *  authenticated history list now carries, sharing-aware under an app pool that does NOT bypass RLS,
 *  and every miss a 404. */
class OutputHistoryPayloadRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with NodePayloadFixtures {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var ownerId, granteeId, strangerId: String = _

  override def beforeAll(): Unit = {
    super.beforeAll()
    startHarness()
    ownerId = seedUser("beta"); granteeId = seedUser(); strangerId = seedUser()
  }
  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private def routesFor(id: String): Route =
    Route.seal(new OutputRoutes(outputService, AuthenticatedUser(UserId(id)), Some(historyService))(harnessEc).routes)

  private val payloadSchema = JsonSchemaValidation.compile("outputs/output-history-payload-response.schema.json")
  private val listSchema    = JsonSchemaValidation.compile("outputs/output-history-response.schema.json")

  private def points(outputId: String, as: String = ownerId): Vector[JsObject] =
    Get(s"/outputs/$outputId/history") ~> routesFor(as) ~> check {
      status shouldBe StatusCodes.OK
      JsonSchemaValidation.validationErrors(listSchema, responseAs[String]) shouldBe Vector.empty
      responseAs[JsObject].fields("points").convertTo[Vector[JsObject]]
    }

  private def rowsOf(outputId: String, pointId: String, as: String = ownerId) =
    Get(s"/outputs/$outputId/history/$pointId/rows") ~> routesFor(as) ~> check { (status, responseAs[String]) }

  /** One real beta run: an opted-in Output (payload) and a plain Output on the same node (no payload). */
  private def runOnce(): PayloadFx = {
    val fx = seedPayloadPipeline(ownerId)
    awaitDb(runService().submit(fx.pid, isDry = false, AuthenticatedUser(UserId(ownerId)))) shouldBe a[Right[_, _]]
    fx
  }

  "the history list" should {
    "carry each point's id and a hasPayload flag that is true only for the linked point" in {
      val fx = runOnce()
      val opted = points(fx.optedOutput)
      opted should have size 1
      opted.head.fields("hasPayload") shouldBe JsBoolean(true)
      UUID.fromString(opted.head.fields("id").convertTo[String]) should not be null
      points(fx.plainOutput).head.fields("hasPayload") shouldBe JsBoolean(false)
    }
  }

  "GET /outputs/:id/history/:point/rows" should {

    "return 200 with the stored rows in order for the owner, and validate against the schema (runId null included)" in {
      val fx     = runOnce()
      val pid    = points(fx.optedOutput).head.fields("id").convertTo[String]
      val (st, raw) = rowsOf(fx.optedOutput, pid)
      st shouldBe StatusCodes.OK
      JsonSchemaValidation.validationErrors(payloadSchema, raw) shouldBe Vector.empty
      val body = raw.parseJson.asJsObject
      body.fields("pointId") shouldBe JsString(pid)
      body.fields("outputId") shouldBe JsString(fx.optedOutput)
      body.fields("rowCount") shouldBe JsNumber(3)
      body.fields("rows").convertTo[Vector[JsObject]].map(_.fields("label")) shouldBe Vector("a", "b", "c").map(JsString(_))

      // A point with a null run id (a grantee-triggered run has none) serializes an explicit null.
      val payload = seedRawPayload(fx.pid.value, Some(fx.stepId.value), None, Instant.now())
      val nullRunPoint = UUID.randomUUID().toString
      awaitDb(db.run(
        sqlu"""INSERT INTO output_snapshot_history (id, output_id, pipeline_id, node_step_id, run_id, trigger_source, captured_at, row_count, summary, payload_id)
               VALUES ($nullRunPoint::uuid, ${fx.optedOutput}, ${fx.pid.value}, ${fx.stepId.value}, NULL, 'manual', now(), 1, '{"v":1}'::jsonb, $payload::uuid)"""
      ))
      val (st2, raw2) = rowsOf(fx.optedOutput, nullRunPoint)
      st2 shouldBe StatusCodes.OK
      JsonSchemaValidation.validationErrors(payloadSchema, raw2) shouldBe Vector.empty
      raw2.parseJson.asJsObject.fields("runId") shouldBe JsNull
    }

    "return 200 for a grantee of the pipeline, under a non-BYPASSRLS app pool" in {
      assertAppPoolEnforcesRls()
      val fx  = runOnce()
      val pid = points(fx.optedOutput).head.fields("id").convertTo[String]
      grantPipeline(fx.pid.value, granteeId)
      rowsOf(fx.optedOutput, pid, as = granteeId)._1 shouldBe StatusCodes.OK
    }

    "404 a point with hasPayload=false" in {
      val fx = runOnce()
      val plainPoint = points(fx.plainOutput).head.fields("id").convertTo[String]
      rowsOf(fx.plainOutput, plainPoint)._1 shouldBe StatusCodes.NotFound
    }

    "404 a stranger with a body identical to an unknown Output" in {
      val fx  = runOnce()
      val pid = points(fx.optedOutput).head.fields("id").convertTo[String]
      val stranger = rowsOf(fx.optedOutput, pid, as = strangerId)
      stranger._1 shouldBe StatusCodes.NotFound
      stranger shouldBe rowsOf(UUID.randomUUID().toString, pid, as = strangerId)
    }

    "404 a point that belongs to a different Output, even one the caller can read" in {
      val a = runOnce()
      val b = runOnce()
      val bPoint = points(b.optedOutput).head.fields("id").convertTo[String]
      rowsOf(a.optedOutput, bPoint)._1 shouldBe StatusCodes.NotFound
    }

    "404 an unknown point id and a non-UUID segment" in {
      val fx = runOnce()
      rowsOf(fx.optedOutput, UUID.randomUUID().toString)._1 shouldBe StatusCodes.NotFound
      rowsOf(fx.optedOutput, "not-a-uuid")._1 shouldBe StatusCodes.NotFound
    }
  }
}
