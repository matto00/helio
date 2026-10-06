package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{JsonSchemaValidation, OutputHistoryApiHarness}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.time.temporal.ChronoUnit
import scala.concurrent.ExecutionContext

/** HEL-1326 design.md D4 (+ HEL-1327 item 1): each resolved `current`/`baseline` point exposes the
 *  metric identity `{field, agg}` its stored summary was computed from, so a reader can check a
 *  baseline OLDER than the 30 returned `points` against the current config. The server's baseline
 *  SELECTION is unchanged (HEL-918 ruling D6): identity is a read-out, never a filter. */
class OutputHistoryMetricIdentityRoutesSpec
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

  private def routes(): Route = new OutputRoutes(outputService, AuthenticatedUser(UserId(ownerId)), Some(historyService))(harnessEc).routes

  private val T: Instant = Instant.now().minus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MILLIS)
  private def daysBefore(d: Long): Instant = T.minus(d, ChronoUnit.DAYS)

  /** A stored v1 summary whose metric was computed from `field`/`agg` (`summaryOf` fixes amount/sum). */
  private def summaryWith(field: String, agg: Option[String], value: Double): JsObject = {
    val base = summaryOf(Some(value))
    JsObject(base.fields + ("metric" -> JsObject(
      "field" -> JsString(field), "agg" -> agg.fold[JsValue](JsNull)(JsString(_)), "value" -> JsNumber(value)
    )))
  }

  private def addWith(oid: String, pid: String, at: Instant, summary: JsObject): Unit =
    awaitDb(db.run(historyRepo.insertAction(Seq(historyEntry(oid, pid, at).copy(summary = summary)))))

  private def identity(o: JsObject, key: String): JsValue = o.fields(key).asJsObject.fields("metric")

  "GET /outputs/:id/history resolved points" should {
    "carry the stored metric identity on current and baseline (RED on main: no `metric` key on either)" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("7d"))
      addWith(oid, pid, daysBefore(8), summaryWith("region", Some("sum"), 0))
      addWith(oid, pid, T, summaryWith("amount", Some("sum"), 12))
      Get(s"/outputs/$oid/history") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val raw  = responseAs[String]
        val body = raw.parseJson.asJsObject
        identity(body, "current") shouldBe JsObject("field" -> JsString("amount"), "agg" -> JsString("sum"))
        identity(body, "baseline") shouldBe JsObject("field" -> JsString("region"), "agg" -> JsString("sum"))
        JsonSchemaValidation.validationErrors(JsonSchemaValidation.compile("outputs/output-history-response.schema.json"), raw) shouldBe Vector.empty
      }
    }

    "expose a null identity (explicit) for a summary with no metric" in {
      val (pid, oid) = seedMetricOutput(ownerId, None)
      addWith(oid, pid, T, summaryOf(None).copy(fields = summaryOf(None).fields + ("metric" -> JsNull)))
      Get(s"/outputs/$oid/history") ~> routes() ~> check {
        responseAs[JsObject].fields("current").asJsObject.fields.get("metric") shouldBe Some(JsNull)
      }
    }

    "HEL-1327 item 1: a window baseline OLDER than the 30 returned points carries a mismatched identity checkable against the current config (RED on main)" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("30d"))
      addWith(oid, pid, daysBefore(45), summaryWith("region", Some("sum"), 0))
      (0L until 30L).foreach(d => addWith(oid, pid, daysBefore(d), summaryWith("amount", Some("sum"), 100.0 - d)))
      Get(s"/outputs/$oid/history") ~> routes() ~> check {
        val body   = responseAs[JsObject]
        val points = body.fields("points").convertTo[Vector[JsObject]]
        points.size shouldBe 30
        // The baseline is not among the returned points, so the points list alone cannot check it ...
        points.map(_.fields("capturedAt")) should not contain JsString(daysBefore(45).toString)
        // ... but its own identity can: it was computed from `region`, the current config uses `amount`.
        body.fields("baseline").asJsObject.fields("capturedAt") shouldBe JsString(daysBefore(45).toString)
        identity(body, "baseline") shouldBe JsObject("field" -> JsString("region"), "agg" -> JsString("sum"))
        identity(body, "current") shouldBe JsObject("field" -> JsString("amount"), "agg" -> JsString("sum"))
      }
    }

    "GUARD: baseline selection is unchanged for a mismatched identity (still the nearest at or before, delta computed)" in {
      val (pid, oid) = seedMetricOutput(ownerId, Some("30d"))
      addWith(oid, pid, daysBefore(45), summaryWith("region", Some("sum"), 20))
      addWith(oid, pid, T, summaryWith("amount", Some("sum"), 50))
      Get(s"/outputs/$oid/history") ~> routes() ~> check {
        val body = responseAs[JsObject]
        body.fields("baseline").asJsObject.fields("capturedAt") shouldBe JsString(daysBefore(45).toString)
        body.fields("delta") shouldBe JsNumber(30)
      }
    }
  }
}
