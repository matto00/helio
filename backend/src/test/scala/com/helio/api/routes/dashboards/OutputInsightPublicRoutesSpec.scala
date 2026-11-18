package com.helio.api.routes.dashboards

import com.helio.api.JsonProtocols
import com.helio.domain.insights.{InsightStatus, StoredInsightCitation}
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{JsonSchemaValidation, OutputInsightApiHarness}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.Files
import java.time.Instant
import java.time.temporal.ChronoUnit
import scala.concurrent.ExecutionContext

/** HEL-1742: `GET /api/dashboards/:d/panels/:p/insight`, through `ApiRoutes`' own wiring (so a missed
 *  `insightReadServiceOpt` wiring is red, not a silent 404). */
class OutputInsightPublicRoutesSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with OutputInsightApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def apiSystem: ActorSystem[Nothing] = typedSystem
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var owner, stranger: String = _

  override def beforeAll(): Unit = { super.beforeAll(); startInsightApi(); owner = seedUser(); stranger = seedUser() }
  override def afterAll(): Unit  = { stopHarness(); super.afterAll() }

  private val T0: Instant = Instant.now().minus(2, ChronoUnit.DAYS).truncatedTo(ChronoUnit.MILLIS)
  private val schemaName  = "outputs/public-output-insight-response.schema.json"
  private val schema      = JsonSchemaValidation.compile(schemaName)

  private def seedDashboard(public: Boolean): String = {
    val id = newId()
    awaitDb(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'Dash', $owner, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${owner}::uuid)"""
    ))
    if (public)
      awaitDb(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                            VALUES ('dashboard', $id, NULL, 'viewer', now())"""))
    id
  }

  private def seedShareToken(dashId: String): String = {
    val token = "insight-share-" + newId()
    awaitDb(db.run(sqlu"""INSERT INTO share_tokens (dashboard_id, user_id, token_hash) VALUES ($dashId, ${owner}::uuid, ${TokenHashing.sha256Hex(token)})"""))
    token
  }

  private def seedPanel(dashId: String, outputId: Option[String]): String = {
    val panelId = newId()
    awaitDb(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
             VALUES ($panelId, $dashId, 'P', $owner, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}',
                     'output', ${outputId}, ${owner}::uuid)"""
    ))
    panelId
  }

  private def path(dashId: String, panelId: String) = s"/api/dashboards/$dashId/panels/$panelId/insight"

  "GET /api/dashboards/:d/panels/:p/insight" should {

    "return only the allow-listed fields for a render whose row has every column populated" in {
      val dashId     = seedDashboard(public = true)
      val (pid, oid) = seedInsightOutput(owner)
      val cite = StoredInsightCitation("c1", "cited-output-secret", "amount", Some(12.5), Some(T0), Some(T0), isPct = true)
      addInsight(oid, pid, T0, markdown = Some("Revenue is up [c1]."), citations = Vector(cite))
      val panelId = seedPanel(dashId, Some(oid))
      Get(path(dashId, panelId)) ~> api ~> check {
        status shouldBe StatusCodes.OK
        val raw  = responseAs[String]
        val body = raw.parseJson.asJsObject
        JsonSchemaValidation.validationErrors(schema, raw) shouldBe Vector.empty
        body.fields.keySet shouldBe Set("render")
        val render = body.fields("render").asJsObject
        render.fields.keySet shouldBe Set("markdown", "citations", "renderedAt")
        render.fields("markdown") shouldBe JsString("Revenue is up [c1].")
        render.fields("renderedAt") shouldBe JsString(T0.toString)
        render.fields("citations").convertTo[Vector[JsObject]].map(_.fields.keySet) shouldBe Vector(Set("id", "field", "number", "date", "capturedAt", "isPct"))
        Seq("model-secret-x", "run-secret-1", "digest-secret-9", "cited-output-secret", oid, pid, "424242", "918273", "645372", "736251", "827364", "costMicros", "inputTokens", "trigger", "status", "\"id\":\"" + oid)
          .foreach(m => withClue(s"leak marker '$m': ")(raw should not include m))
      }
    }

    "return 200 render null for an insight Output whose only attempt failed, leaking no status" in {
      val dashId     = seedDashboard(public = true)
      val (pid, oid) = seedInsightOutput(owner)
      addInsight(oid, pid, T0, status = InsightStatus.SkippedQuota)
      val panelId = seedPanel(dashId, Some(oid))
      Get(path(dashId, panelId)) ~> api ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson shouldBe JsObject("render" -> JsNull)
      }
    }

    "answer an anonymous caller and a signed-in stranger on a private dashboard exactly as an unknown dashboard" in {
      val dashId     = seedDashboard(public = false)
      val (pid, oid) = seedInsightOutput(owner)
      addInsight(oid, pid, T0)
      val panelId = seedPanel(dashId, Some(oid))
      val unknown = Get(path(newId(), panelId)) ~> api ~> check { (status, responseAs[String]) }
      unknown._1 shouldBe StatusCodes.NotFound
      Get(path(dashId, panelId)) ~> api ~> check { (status, responseAs[String]) shouldBe unknown }
      authed(Get(path(dashId, panelId)), stranger) ~> api ~> check { (status, responseAs[String]) shouldBe unknown }
    }

    "serve a private dashboard to a valid share token" in {
      val dashId     = seedDashboard(public = false)
      val (pid, oid) = seedInsightOutput(owner)
      addInsight(oid, pid, T0)
      val panelId = seedPanel(dashId, Some(oid))
      val token   = seedShareToken(dashId)
      Get(path(dashId, panelId) + s"?token=$token") ~> api ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsObject].fields("render") should not be JsNull
      }
      Get(path(dashId, panelId) + "?token=wrong") ~> api ~> check { status shouldBe StatusCodes.NotFound }
    }

    "404 a panel that belongs to another dashboard" in {
      val dashA      = seedDashboard(public = true)
      val dashB      = seedDashboard(public = true)
      val (pid, oid) = seedInsightOutput(owner)
      addInsight(oid, pid, T0)
      val panelOnB = seedPanel(dashB, Some(oid))
      Get(path(dashA, panelOnB)) ~> api ~> check { status shouldBe StatusCodes.NotFound }
      Get(path(dashB, panelOnB)) ~> api ~> check { status shouldBe StatusCodes.OK }
    }

    "name the panel on this dashboard for a placed cited Output, none for an unplaced one or one placed only elsewhere (HEL-1744 D8)" in {
      val dashId      = seedDashboard(public = true)
      val otherDashId = seedDashboard(public = true)
      val (pid, oid)  = seedInsightOutput(owner)
      val (_, placed)    = seedInsightOutput(owner, kind = "metric")
      val (_, unplaced)  = seedInsightOutput(owner, kind = "metric")
      val (_, elsewhere) = seedInsightOutput(owner, kind = "metric")
      val citations = Vector(
        StoredInsightCitation("c1", placed, "amount", Some(1.0), None, None, isPct = false),
        StoredInsightCitation("c2", unplaced, "amount", Some(2.0), None, None, isPct = false),
        StoredInsightCitation("c3", elsewhere, "amount", Some(3.0), None, None, isPct = false)
      )
      addInsight(oid, pid, T0, markdown = Some("A [c1] B [c2] C [c3]."), citations = citations)
      val insightPanel = seedPanel(dashId, Some(oid))
      val placedPanel  = seedPanel(dashId, Some(placed))
      seedPanel(otherDashId, Some(elsewhere))
      Get(path(dashId, insightPanel)) ~> api ~> check {
        status shouldBe StatusCodes.OK
        val raw = responseAs[String]
        JsonSchemaValidation.validationErrors(schema, raw) shouldBe Vector.empty
        val byId = raw.parseJson.asJsObject.fields("render").asJsObject.fields("citations").convertTo[Vector[JsObject]].map(c => c.fields("id").convertTo[String] -> c).toMap
        byId("c1").fields.get("panelId") shouldBe Some(JsString(placedPanel))
        byId("c2").fields.get("panelId") shouldBe None
        byId("c3").fields.get("panelId") shouldBe None
        Seq(placed, unplaced, elsewhere).foreach(o => withClue(s"cited output id $o: ")(raw should not include o))
      }
    }

    "choose the lowest panel id when a cited Output is placed twice on the dashboard (HEL-1744 D8)" in {
      val dashId     = seedDashboard(public = true)
      val (pid, oid) = seedInsightOutput(owner)
      val (_, placed) = seedInsightOutput(owner, kind = "metric")
      addInsight(oid, pid, T0, markdown = Some("A [c1]."), citations = Vector(StoredInsightCitation("c1", placed, "amount", Some(1.0), None, None, isPct = false)))
      val insightPanel = seedPanel(dashId, Some(oid))
      val twoPanels    = Vector(seedPanel(dashId, Some(placed)), seedPanel(dashId, Some(placed)))
      Get(path(dashId, insightPanel)) ~> api ~> check {
        status shouldBe StatusCodes.OK
        val c1 = responseAs[JsObject].fields("render").asJsObject.fields("citations").convertTo[Vector[JsObject]].head
        c1.fields.get("panelId") shouldBe Some(JsString(twoPanels.min))
      }
    }

    "404 a panel bound to a non-insight Output and an unknown panel" in {
      val dashId     = seedDashboard(public = true)
      val (pid, oid) = seedInsightOutput(owner, kind = "metric")
      addInsight(oid, pid, T0)
      Get(path(dashId, seedPanel(dashId, Some(oid)))) ~> api ~> check { status shouldBe StatusCodes.NotFound }
      Get(path(dashId, newId())) ~> api ~> check { status shouldBe StatusCodes.NotFound }
    }
  }

  "the public insight schema" should {
    "name no cost, model, token, run-id, digest, trigger, status or outputId property anywhere" in {
      def keys(v: JsValue): Set[String] = v match {
        case o: JsObject => o.fields.keySet ++ o.fields.values.flatMap(keys)
        case a: JsArray  => a.elements.flatMap(keys).toSet
        case _           => Set.empty
      }
      val schemaKeys = keys(Files.readString(JsonSchemaValidation.schemaFile(schemaName).toPath).parseJson)
      val forbidden  = Set("cost", "costMicros", "model", "inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens", "runId", "inputDigest", "trigger", "status", "outputId")
      (schemaKeys intersect forbidden) shouldBe empty
      schemaKeys.filter(_.toLowerCase.matches(".*(cost|token|runid|digest).*")) shouldBe empty
      schemaKeys should contain allOf ("render", "markdown", "citations", "renderedAt")
    }
  }
}
