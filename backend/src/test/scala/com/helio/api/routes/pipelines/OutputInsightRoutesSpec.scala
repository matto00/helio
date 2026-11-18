package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.domain.insights.{InsightStatus, InsightTrigger, StoredInsightCitation}
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{JsonSchemaValidation, OutputInsightApiHarness}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.time.temporal.ChronoUnit
import scala.concurrent.ExecutionContext

/** HEL-1742: `GET /api/outputs/:id/insight` and `/insight/history`, through `ApiRoutes`' own wiring. */
class OutputInsightRoutesSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with OutputInsightApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def apiSystem: ActorSystem[Nothing] = typedSystem
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var owner, grantee, stranger: String = _

  override def beforeAll(): Unit = {
    super.beforeAll()
    startInsightApi()
    assertAppPoolEnforcesRls()
    owner = seedUser(); grantee = seedUser(); stranger = seedUser()
  }
  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private val T0: Instant = Instant.now().minus(2, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MILLIS)
  private def at(minutes: Long): Instant = T0.plus(minutes, ChronoUnit.MINUTES)

  private val insightSchema = JsonSchemaValidation.compile("outputs/output-insight-response.schema.json")
  private val historySchema = JsonSchemaValidation.compile("outputs/output-insight-history-response.schema.json")

  "GET /api/outputs/:id/insight" should {

    "return the newest ok render and, separately, a newer failed attempt" in {
      val (pid, oid) = seedInsightOutput(owner)
      val cite       = StoredInsightCitation("c1", oid, "amount", Some(12.5), None, Some(at(0)), isPct = false)
      addInsight(oid, pid, at(0), markdown = Some("Old good render [c1]."), citations = Vector(cite))
      addInsight(oid, pid, at(10), markdown = Some("Newest good render [c1]."), citations = Vector(cite), trigger = InsightTrigger.Manual)
      addInsight(oid, pid, at(20), status = InsightStatus.Failed)
      authed(Get(s"/api/outputs/$oid/insight"), owner) ~> api ~> check {
        status shouldBe StatusCodes.OK
        val raw  = responseAs[String]
        val body = raw.parseJson.asJsObject
        JsonSchemaValidation.validationErrors(insightSchema, raw) shouldBe Vector.empty
        body.fields("outputId") shouldBe JsString(oid)
        val render = body.fields("render").asJsObject
        render.fields("markdown") shouldBe JsString("Newest good render [c1].")
        render.fields("trigger") shouldBe JsString("manual")
        render.fields("createdAt") shouldBe JsString(at(10).toString)
        render.fields("model") shouldBe JsString("model-secret-x")
        render.fields("costMicros") shouldBe JsNumber(424242)
        render.fields("citations").convertTo[Vector[JsObject]].head.fields("outputId") shouldBe JsString(oid)
        val attempt = body.fields("lastAttempt").asJsObject
        attempt.fields("status") shouldBe JsString("failed")
        attempt.fields.keySet shouldBe Set("id", "status", "trigger", "createdAt")
      }
    }

    "carry explicit nulls for render and lastAttempt when the Output has no rows" in {
      val (_, oid) = seedInsightOutput(owner)
      authed(Get(s"/api/outputs/$oid/insight"), owner) ~> api ~> check {
        status shouldBe StatusCodes.OK
        val raw = responseAs[String]
        JsonSchemaValidation.validationErrors(insightSchema, raw) shouldBe Vector.empty
        val body = raw.parseJson.asJsObject
        body.fields.keySet shouldBe Set("outputId", "render", "lastAttempt")
        body.fields("render") shouldBe JsNull
        body.fields("lastAttempt") shouldBe JsNull
      }
    }

    "report a skipped attempt as lastAttempt with render null when no ok row exists" in {
      val (pid, oid) = seedInsightOutput(owner)
      addInsight(oid, pid, at(0), status = InsightStatus.SkippedQuota)
      authed(Get(s"/api/outputs/$oid/insight"), owner) ~> api ~> check {
        val body = responseAs[JsObject]
        body.fields("render") shouldBe JsNull
        body.fields("lastAttempt").asJsObject.fields("status") shouldBe JsString("skipped_quota")
      }
    }

    "serve a user the pipeline is shared with" in {
      val (pid, oid) = seedInsightOutput(owner)
      addInsight(oid, pid, at(0))
      grantPipeline(pid, grantee)
      authed(Get(s"/api/outputs/$oid/insight"), grantee) ~> api ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsObject].fields("render") should not be JsNull
      }
    }

    "answer a non-grantee with exactly the 404 an unknown id gets" in {
      val (pid, oid) = seedInsightOutput(owner)
      addInsight(oid, pid, at(0))
      val unknown = authed(Get(s"/api/outputs/${newId()}/insight"), stranger) ~> api ~> check { (status, responseAs[String]) }
      unknown._1 shouldBe StatusCodes.NotFound
      authed(Get(s"/api/outputs/$oid/insight"), stranger) ~> api ~> check {
        (status, responseAs[String]) shouldBe unknown
      }
    }

    "answer an accessible non-insight Output with the same 404, even with leftover insight rows" in {
      val (pid, oid) = seedInsightOutput(owner, kind = "metric")
      addInsight(oid, pid, at(0))
      val unknown = authed(Get(s"/api/outputs/${newId()}/insight"), owner) ~> api ~> check { (status, responseAs[String]) }
      authed(Get(s"/api/outputs/$oid/insight"), owner) ~> api ~> check { (status, responseAs[String]) shouldBe unknown }
      authed(Get(s"/api/outputs/$oid/insight/history"), owner) ~> api ~> check { (status, responseAs[String]) shouldBe unknown }
    }

    "require authentication" in {
      val (_, oid) = seedInsightOutput(owner)
      Get(s"/api/outputs/$oid/insight") ~> api ~> check { status shouldBe StatusCodes.Unauthorized }
    }

    "never create or change a row (a read leaves the table untouched)" in {
      val (pid, oid) = seedInsightOutput(owner)
      addInsight(oid, pid, at(0))
      authed(Get(s"/api/outputs/$oid/insight"), owner) ~> api ~> check { status shouldBe StatusCodes.OK }
      authed(Get(s"/api/outputs/$oid/insight/history"), owner) ~> api ~> check { status shouldBe StatusCodes.OK }
      insightCount(oid) shouldBe 1
    }
  }

  "GET /api/outputs/:id/insight/history" should {

    "list every attempt newest first, whatever its status" in {
      val (pid, oid) = seedInsightOutput(owner)
      addInsight(oid, pid, at(0), markdown = Some("first"))
      addInsight(oid, pid, at(5), status = InsightStatus.Failed)
      addInsight(oid, pid, at(10), status = InsightStatus.SkippedUnchanged)
      addInsight(oid, pid, at(15), markdown = Some("last"))
      authed(Get(s"/api/outputs/$oid/insight/history"), owner) ~> api ~> check {
        status shouldBe StatusCodes.OK
        val raw = responseAs[String]
        JsonSchemaValidation.validationErrors(historySchema, raw) shouldBe Vector.empty
        val items = raw.parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]]
        items.map(_.fields("status").convertTo[String]) shouldBe Vector("ok", "skipped_unchanged", "failed", "ok")
        items.map(_.fields.get("markdown")) shouldBe Vector(Some(JsString("last")), None, None, Some(JsString("first")))
      }
    }

    "apply since in SQL before limit" in {
      val (pid, oid) = seedInsightOutput(owner)
      (0 to 4).foreach(i => addInsight(oid, pid, at(i * 10L), markdown = Some(s"r$i")))
      // Inclusive since: r2 and newer only, newest first; r0 and r1 must never appear.
      authed(Get(s"/api/outputs/$oid/insight/history?since=${at(20)}&limit=4"), owner) ~> api ~> check {
        responseAs[JsObject].fields("items").convertTo[Vector[JsObject]].map(_.fields("markdown")) shouldBe Vector("r4", "r3", "r2").map(JsString(_))
      }
      authed(Get(s"/api/outputs/$oid/insight/history?limit=2"), owner) ~> api ~> check {
        responseAs[JsObject].fields("items").convertTo[Vector[JsObject]].map(_.fields("markdown")) shouldBe Vector("r4", "r3").map(JsString(_))
      }
    }

    "400 an out-of-range limit or malformed since, never clamping" in {
      val (_, oid) = seedInsightOutput(owner)
      Seq("?limit=0", "?limit=101", "?limit=x", "?since=nope").foreach { q =>
        authed(Get(s"/api/outputs/$oid/insight/history$q"), owner) ~> api ~> check { withClue(q)(status shouldBe StatusCodes.BadRequest) }
      }
      authed(Get(s"/api/outputs/$oid/insight/history?limit=100"), owner) ~> api ~> check { status shouldBe StatusCodes.OK }
    }

    "answer a non-grantee with the unknown-id 404" in {
      val (pid, oid) = seedInsightOutput(owner)
      addInsight(oid, pid, at(0))
      val unknown = authed(Get(s"/api/outputs/${newId()}/insight/history"), stranger) ~> api ~> check { (status, responseAs[String]) }
      authed(Get(s"/api/outputs/$oid/insight/history"), stranger) ~> api ~> check { (status, responseAs[String]) shouldBe unknown }
    }
  }
}
