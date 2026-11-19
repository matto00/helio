package com.helio.api.protocols

import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.infrastructure.ai.ClaudeApiToolRequest
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.AskScript._
import com.helio.testsupport.{AskApiHarness, JsonSchemaValidation, ScriptedTransport}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethods, HttpRequest}
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.concurrent.Eventually
import org.scalatest.matchers.should.Matchers
import org.scalatest.time.{Millis, Seconds, Span}
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.{Files, Paths}
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.regex.Matcher
import scala.collection.mutable
import scala.concurrent.ExecutionContext

/** HEL-1747 task 1, the server half of the agent exit criterion. One seeded world, six legs through the REAL `ApiRoutes`
 *  with a scripted (fake) model behind the real `ClaudeInsightClient` and `AskDataService`: an agent adds an insight Output to
 *  an existing pipeline, refreshes it, reads the cited narrative, places it on a dashboard, asks that dashboard a question and
 *  pins the answer. Each leg is recorded as {method, path, request body, status, response body}, normalised, and the committed
 *  `shared-test-fixtures/insight/exit-criterion.json` must equal it. The helio-mcp test (`insightExitCriterion.test.ts`) replays
 *  the same legs through the real MCP server, so its fake backend can never drift from what the routes write. No live model
 *  call is possible: the transport is a script. Regenerate with `HEL1747_WRITE_FIXTURE=1 sbt "testOnly *InsightSeamSpec"`. */
class InsightSeamSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with AskApiHarness with Eventually {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext
  override protected def apiSystem: ActorSystem[Nothing] = typedSystem

  // Explicit patience, no Thread.sleep: the refresh answers 202 before the render lands.
  implicit override val patienceConfig: PatienceConfig = PatienceConfig(timeout = Span(10, Seconds), interval = Span(50, Millis))

  private val fixturePath = Paths.get("../shared-test-fixtures/insight/exit-criterion.json")

  private var owner: String           = _
  private var pid, board: String      = _
  private var rev: Output             = _
  private var scriptedApi: Route             = _

  override def beforeAll(): Unit = {
    super.beforeAll(); startHarness()
    owner = seedUser("owner")
    pid = seedPipelineWithOutput(owner, "table")._1
    // Revenue is a metric with a previous_run compare and two history points, so a Revenue number (its current value) reaches
    // the insight's grounding pack: a read Output contributes to the pack only through a compare or a window.
    val metricConfig = """{"fieldMapping":{"value":"amount"},"aggregation":{"value":"amount","agg":"sum"},"compare":"previous_run"}""".parseJson.asJsObject
    rev = addOutput(pid, owner, "Revenue", OutputKind.Metric, regionSchema, metricConfig)
    seedRows(pid, Seq(regionRow("east", 10)))
    addPoint(rev.id.value, pid, Instant.now().minus(2, ChronoUnit.DAYS), Some(100.0))
    addPoint(rev.id.value, pid, Instant.now().minus(1, ChronoUnit.DAYS), Some(120.0))
    board = seedBoard(owner)
    seedBoardPanel(board, owner, rev.id.value, "Revenue panel")
    scriptedApi = buildAskApi("claude-haiku-5-5")
  }

  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private val question = "How is revenue doing?"

  /** One recorded leg, raw (real ids and instants) until [[normalise]]. */
  private final case class Leg(name: String, method: String, path: String, request: Option[JsValue], status: Int, response: JsValue)

  private val legs = mutable.ArrayBuffer.empty[Leg]

  private def call(name: String, method: String, path: String, body: Option[JsValue]): JsValue = {
    val entity = HttpEntity(ContentTypes.`application/json`, body.map(_.compactPrint).getOrElse(""))
    val httpMethod = if (method == "GET") HttpMethods.GET else HttpMethods.POST
    val req = if (method == "GET") HttpRequest(httpMethod, path) else HttpRequest(httpMethod, path, entity = entity)
    var out: (Int, String) = (0, "")
    askAuthed(req, owner) ~> scriptedApi ~> check { out = (status.intValue, responseAs[String]) }
    val parsed = out._2.parseJson
    legs += Leg(name, method, path, body, out._1, parsed)
    withClue(s"$name: ")(out._1 should (be >= 200 and be < 300))
    parsed
  }

  /** The `citations` array of the pack the model is shown (between the insight data tags of the last user message). */
  private def packCitations(request: ClaudeApiToolRequest): Vector[JsObject] = {
    val text  = request.messages.last.content.flatMap(_.text).mkString
    val start = text.indexOf("<insight_data>") + "<insight_data>".length
    val end   = text.indexOf("</insight_data>")
    require(start > "<insight_data>".length - 1 && end > start, s"no insight data block in: $text")
    text.substring(start, end).parseJson.asJsObject.fields("citations").convertTo[Vector[JsObject]]
  }

  /** hop 0 = the insight render; hop 1 = the ask's tool call; hop 2 = the ask's cited answer. Any extra model call consumes a
   *  turn and fails the call-count assertion. */
  private def script(): ScriptedTransport = new ScriptedTransport(Vector(
    r => {
      // The narrative must be about Revenue: cite Revenue's current value, never the insight's own head.
      val c = packCitations(r).find(c => c.fields("outputId") == JsString(rev.id.value) && c.fields("field").convertTo[String].endsWith(".current"))
        .getOrElse(sys.error("no Revenue citation in the pack"))
      Seq(text(s"The ${c.fields("field").convertTo[String]} is ${c.fields("value")} [${c.fields("id").convertTo[String]}]."))
    },
    _ => Seq(toolUse("t1", "get_output_rows", obj("outputId" -> JsString(rev.id.value)))),
    r => Seq(text(lastResults(r).map { case (_, res, _) =>
      val c = citations(res).find(_.fields("field") == JsString("amount")).get
      s"An amount is ${c.fields("value")} [${c.fields("id").convertTo[String]}]."
    }.mkString(" ")))
  ))

  private def insightRows(outputId: String): Int =
    awaitDb(db.run(sql"SELECT count(*) FROM output_insights WHERE output_id = $outputId AND status = 'ok'".as[Int].head))

  // ----- normalisation -------------------------------------------------------------------------------------------------

  private val instant = "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z".r
  private val uuid    = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}".r
  private val hex64   = "[0-9a-f]{64}".r
  private val marker  = "\\[(c[0-9]+)\\]".r

  /** Generated ids to named placeholders, the residual ids to `{{ID_n}}` in order of first appearance across the legs, the input
   *  digest to `{{INPUT_DIGEST}}`, instants to one fixed instant, and each leg's citation ids (random per run) to c1, c2, ... */
  private def normalise(raw: Vector[Leg], known: Map[String, String]): JsValue = {
    val residual = mutable.LinkedHashMap.empty[String, String]
    def citeMap(v: JsValue): Map[String, String] = {
      val ids = mutable.ArrayBuffer.empty[String]
      def find(x: JsValue): Unit = x match {
        case JsObject(f) =>
          if (f.contains("outputId") && f.contains("isPct") && f.contains("id")) ids += f("id").convertTo[String]
          f.values.foreach(find)
        case JsArray(e) => e.foreach(find)
        case _          =>
      }
      find(v)
      ids.distinct.zipWithIndex.map { case (id, i) => id -> s"c${i + 1}" }.toMap
    }
    def str(s: String, cmap: Map[String, String]): String = {
      val named  = known.toSeq.sortBy(-_._1.length).foldLeft(s) { case (acc, (id, ph)) => acc.replace(id, ph) }
      val digest = hex64.replaceAllIn(named, "{{INPUT_DIGEST}}")
      val ids    = uuid.replaceAllIn(digest, m => Matcher.quoteReplacement(residual.getOrElseUpdate(m.group(0), s"{{ID_${residual.size + 1}}}")))
      val marked = marker.replaceAllIn(ids, m => Matcher.quoteReplacement(s"[${cmap.getOrElse(m.group(1), m.group(1))}]"))
      instant.replaceAllIn(marked, "2026-01-01T00:00:00Z")
    }
    def walk(v: JsValue, cmap: Map[String, String]): JsValue = v match {
      case JsString(s) => JsString(str(s, cmap))
      case JsObject(f) =>
        val renamed = if (f.contains("outputId") && f.contains("isPct") && f.contains("id")) f.updated("id", JsString(cmap(f("id").convertTo[String]))) else f
        JsObject(renamed.map { case (k, x) => str(k, cmap) -> walk(x, cmap) })
      case JsArray(e) => JsArray(e.map(walk(_, cmap)))
      case other      => other
    }
    JsObject("legs" -> JsArray(raw.map { l =>
      val cmap = citeMap(l.response)
      val base = Map(
        "name"     -> JsString(l.name),
        "method"   -> JsString(l.method),
        "path"     -> JsString(str(l.path, Map.empty)),
        "status"   -> JsNumber(l.status),
        "response" -> walk(l.response, cmap)
      )
      JsObject(l.request.fold(base)(r => base + ("request" -> walk(r, cmap))))
    }))
  }

  private def idOf(v: JsValue): String = v.asJsObject.fields("id").convertTo[String]

  "the agent exit criterion (server half)" should {
    "write six legs equal to the committed fixture, with a cited narrative and a cited answer, and call the model exactly three times" in {
      val transport = script()
      switch.current = transport

      // 1. add an insight Output to the existing pipeline (refresh manual: no on_run, daily or create-time render can fire).
      val created = call("add-insight-output", "POST", s"/api/pipelines/$pid/outputs", Some(JsObject(
        "kind"   -> JsString("insight"),
        "name"   -> JsString("Revenue narrative"),
        "config" -> JsObject("refresh" -> JsString("manual"), "reads" -> JsObject("outputs" -> JsArray(JsString(rev.id.value))))
      )))
      val insightId = idOf(created)
      transport.hopCount shouldBe 0

      // 2. refresh it: 202 before the model answers.
      val refreshed = call("refresh-insight", "POST", s"/api/outputs/$insightId/insight/refresh", None)
      refreshed.asJsObject.fields("started") shouldBe JsBoolean(true)
      eventually(insightRows(insightId) shouldBe 1)

      // 3. read the narrative as the owner.
      val read = call("get-insight", "GET", s"/api/outputs/$insightId/insight", None).asJsObject
      val render = read.fields("render").asJsObject
      val markdown = render.fields("markdown").convertTo[String]
      val cites = render.fields("citations").convertTo[Vector[JsObject]]
      cites.size should be >= 1
      withClue("the narrative must cite Revenue (the insight reads it): ")(cites.map(_.fields("outputId")) should contain(JsString(rev.id.value)))
      cites.foreach(c => markdown should include(s"[${c.fields("id").convertTo[String]}]"))
      read.fields("canRefresh") shouldBe JsBoolean(true)

      // 4. place the insight on the dashboard that already carries Revenue.
      call("place-insight", "POST", "/api/panels/batch", Some(JsObject(
        "dashboardId" -> JsString(board),
        "panels"      -> JsArray(JsObject("title" -> JsString("Revenue narrative"), "type" -> JsString("output"), "config" -> JsObject("outputId" -> JsString(insightId))))
      )))

      // 5. ask THAT dashboard a question.
      val answer = call("ask-dashboard", "POST", s"/api/dashboards/$board/ask", Some(JsObject("question" -> JsString(question)))).asJsObject
      answer.fields("citations").convertTo[Vector[JsObject]].size should be >= 1
      answer.fields("pin") should not be JsNull
      val pin = answer.fields("pin").asJsObject

      // 6. pin the answer: the request the ask returned, posted as is.
      val pinned = call("pin-answer", "POST", s"/api/pipelines/${pin.fields("pipelineId").convertTo[String]}/outputs", Some(pin.fields("request")))

      // The recorded script is the only model traffic: one render, one ask tool hop, one ask answer.
      transport.hopCount shouldBe 3

      // Raw bodies satisfy their schemas (real ids and instants), then the normalised legs equal the committed fixture.
      JsonSchemaValidation.validationErrors(JsonSchemaValidation.compile("outputs/output-insight-refresh-response.schema.json"), legs(1).response.compactPrint) shouldBe empty
      JsonSchemaValidation.validationErrors(JsonSchemaValidation.compile("outputs/output-insight-response.schema.json"), legs(2).response.compactPrint) shouldBe empty
      JsonSchemaValidation.validationErrors(JsonSchemaValidation.compile("ask/ask-response.schema.json"), legs(4).response.compactPrint) shouldBe empty

      val rowIds = Seq(render.fields("id"), read.fields("lastAttempt").asJsObject.fields("id")).map(_.convertTo[String]).distinct
      val known = (Seq(pid -> "{{PIPELINE_1}}", rev.id.value -> "{{OUTPUT_REVENUE}}", board -> "{{DASHBOARD_1}}", insightId -> "{{OUTPUT_INSIGHT}}", idOf(pinned) -> "{{OUTPUT_PIN}}") ++
        rowIds.zipWithIndex.map { case (id, i) => id -> s"{{INSIGHT_ROW_${i + 1}}}" }).toMap
      val produced = normalise(legs.toVector, known)

      if (sys.env.contains("HEL1747_WRITE_FIXTURE")) { Files.createDirectories(fixturePath.getParent); Files.writeString(fixturePath, produced.prettyPrint + "\n") }
      val committed = Files.readString(fixturePath).parseJson
      withClue("shared-test-fixtures/insight/exit-criterion.json differs from what the real routes write: ")(committed shouldBe produced)
    }
  }
}
