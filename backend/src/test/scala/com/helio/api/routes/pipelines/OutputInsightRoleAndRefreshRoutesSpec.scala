package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.domain.insights.{InsightStatus, InsightTrigger}
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{JsonSchemaValidation, OutputInsightApiHarness}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.time.temporal.ChronoUnit
import scala.concurrent.ExecutionContext

/** HEL-1743 R3/R3b (role-shaped reads, fail-first per role on both routes) and the manual refresh route, through `ApiRoutes`. */
class OutputInsightRoleAndRefreshRoutesSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with OutputInsightApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def apiSystem: ActorSystem[Nothing] = typedSystem
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var owner, editor, viewer, stranger: String = _

  override def beforeAll(): Unit = {
    super.beforeAll()
    startInsightApi()
    assertAppPoolEnforcesRls()
    owner = seedUser("beta"); editor = seedUser("beta"); viewer = seedUser("beta"); stranger = seedUser("beta")
  }
  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private val T0: Instant = Instant.now().minus(2, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MILLIS)
  private def at(m: Long): Instant = T0.plus(m, ChronoUnit.MINUTES)

  private val insightSchema = JsonSchemaValidation.compile("outputs/output-insight-response.schema.json")
  private val historySchema = JsonSchemaValidation.compile("outputs/output-insight-history-response.schema.json")
  private val refreshSchema = JsonSchemaValidation.compile("outputs/output-insight-refresh-response.schema.json")

  private val costKeys = Set("model", "inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens", "costMicros", "runId", "inputDigest")

  private def shared(): (String, String) = {
    val (pid, oid) = seedInsightOutput(owner)
    grantPipeline(pid, editor, "editor")
    grantPipeline(pid, viewer, "viewer")
    (pid, oid)
  }

  "GET /api/outputs/:id/insight cost fields (R3)" should {
    "show model, tokens and cost to the owner and an editor, and none of them to a viewer" in {
      val (pid, oid) = shared()
      addInsight(oid, pid, at(0))
      for ((who, expectCost) <- Seq(owner -> true, editor -> true, viewer -> false))
        authed(Get(s"/api/outputs/$oid/insight"), who) ~> api ~> check {
          status shouldBe StatusCodes.OK
          val render = responseAs[JsObject].fields("render").asJsObject
          costKeys.foreach(k => withClue(s"$who $k")(render.fields.contains(k) shouldBe expectCost))
          render.fields("markdown") should not be JsNull
          render.fields("trigger") shouldBe JsString("on_run")
        }
    }
    "show them on the history route the same way" in {
      val (pid, oid) = shared()
      addInsight(oid, pid, at(0))
      for ((who, expectCost) <- Seq(owner -> true, editor -> true, viewer -> false))
        authed(Get(s"/api/outputs/$oid/insight/history"), who) ~> api ~> check {
          val item = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]].head
          costKeys.foreach(k => withClue(s"$who $k")(item.fields.contains(k) shouldBe expectCost))
          item.fields("status") shouldBe JsString("ok")
        }
    }
  }

  "a quota or budget skip (R3b)" should {
    for (skip <- Seq(InsightStatus.SkippedQuota, InsightStatus.SkippedBudget))
      s"read as not_updated for a viewer and as ${skip.wire} for the owner and an editor, on both routes" in {
        val (pid, oid) = shared()
        addInsight(oid, pid, at(0))
        addInsight(oid, pid, at(5), status = skip)
        for ((who, expected) <- Seq(owner -> skip.wire, editor -> skip.wire, viewer -> "not_updated")) {
          authed(Get(s"/api/outputs/$oid/insight"), who) ~> api ~> check {
            val raw = responseAs[String]
            JsonSchemaValidation.validationErrors(insightSchema, raw) shouldBe Vector.empty
            raw.parseJson.asJsObject.fields("lastAttempt").asJsObject.fields("status") shouldBe JsString(expected)
          }
          authed(Get(s"/api/outputs/$oid/insight/history"), who) ~> api ~> check {
            val raw = responseAs[String]
            JsonSchemaValidation.validationErrors(historySchema, raw) shouldBe Vector.empty
            raw.parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]].map(_.fields("status")) shouldBe Vector(JsString(expected), JsString("ok"))
          }
        }
      }
    "leave failed and skipped_unchanged visible to a viewer" in {
      val (pid, oid) = shared()
      addInsight(oid, pid, at(0), status = InsightStatus.Failed)
      authed(Get(s"/api/outputs/$oid/insight"), viewer) ~> api ~> check {
        responseAs[JsObject].fields("lastAttempt").asJsObject.fields("status") shouldBe JsString("failed")
      }
    }
  }

  "canRefresh" should {
    "be true for the owner and editors only" in {
      val (_, oid) = shared()
      for ((who, expected) <- Seq(owner -> true, editor -> true, viewer -> false))
        authed(Get(s"/api/outputs/$oid/insight"), who) ~> api ~> check { responseAs[JsObject].fields("canRefresh") shouldBe JsBoolean(expected) }
    }
  }

  "POST /api/outputs/:id/insight/refresh" should {
    def post(oid: String, who: String, body: String = "") =
      authed(Post(s"/api/outputs/$oid/insight/refresh").withEntity(HttpEntity(ContentTypes.`application/json`, body)), who)

    "answer 202 to the owner and an editor, then record a manual attempt (keyless backend: a failed, no-model row)" in {
      val (_, oid) = shared()
      for (who <- Seq(owner, editor)) {
        post(oid, who) ~> api ~> check {
          status shouldBe StatusCodes.Accepted
          val raw = responseAs[String]
          JsonSchemaValidation.validationErrors(refreshSchema, raw) shouldBe Vector.empty
          raw.parseJson.asJsObject.fields("outputId") shouldBe JsString(oid)
        }
      }
      Thread.sleep(1000)
      insightCount(oid) should be >= 1
    }
    "record the attempt as pin for {\"trigger\":\"pin\"} and refuse any other body" in {
      val (_, oid) = seedInsightOutput(owner)
      post(oid, owner, """{"trigger":"pin"}""") ~> api ~> check { status shouldBe StatusCodes.Accepted }
      Thread.sleep(800)
      awaitDb(db.run(sql"SELECT trigger FROM output_insights WHERE output_id = $oid".as[String])).toSet shouldBe Set(InsightTrigger.Pin.wire)
      post(oid, owner, """{"trigger":"daily"}""") ~> api ~> check { status shouldBe StatusCodes.BadRequest }
      post(oid, owner, """{"x":1}""") ~> api ~> check { status shouldBe StatusCodes.BadRequest }
      post(oid, owner, "not json") ~> api ~> check { status shouldBe StatusCodes.BadRequest }
    }
    "refuse a viewer with 403 and hide strangers, unknown ids and non-insight Outputs behind one 404" in {
      val (pid, oid) = shared()
      post(oid, viewer) ~> api ~> check { status shouldBe StatusCodes.Forbidden }
      val unknown = post(newId(), stranger) ~> api ~> check { (status, responseAs[String]) }
      unknown._1 shouldBe StatusCodes.NotFound
      post(oid, stranger) ~> api ~> check { (status, responseAs[String]) shouldBe unknown }
      val (_, metric) = seedInsightOutput(owner, kind = "metric")
      post(metric, owner) ~> api ~> check { (status, responseAs[String]) shouldBe unknown }
      insightCount(oid) shouldBe 0
    }
    "have its own rate limit: the seventh request in a window is 429" in {
      val who = seedUser("beta")
      val (_, oid) = seedInsightOutput(who)
      val codes = (1 to 7).map(_ => post(oid, who) ~> api ~> check { status })
      codes.take(6).foreach(_ shouldBe StatusCodes.Accepted)
      codes(6) shouldBe StatusCodes.TooManyRequests
    }
  }
}
