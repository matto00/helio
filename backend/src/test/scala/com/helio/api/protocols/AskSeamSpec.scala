package com.helio.api.protocols

import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.infrastructure.ai.ClaudeModelCatalog
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.AskScript._
import com.helio.testsupport.{AskApiHarness, JsonSchemaValidation, ScriptedTransport}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethods, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.{Files, Paths}
import java.time.{LocalDate, ZoneOffset}
import java.util.regex.Matcher
import scala.concurrent.ExecutionContext

/** HEL-1746 task 1, the server half of the ask wire seam. Every ask body the web client handles (200 with a pin, 200 with
 *  `pin: null`, both 422s, 403, 429) is what the REAL routes write, normalised (generated ids to placeholders, instants to
 *  one fixed instant), and the committed copy under `shared-test-fixtures/ask/` must equal it and validate against its
 *  schema. The client half (`ask.contract.test.ts`) and the Playwright spec read the same files, so the browser-level fake of
 *  `/ask` can never drift from what the server writes. Regenerate with `HEL1746_WRITE_FIXTURE=1 sbt "testOnly *AskSeamSpec"`. */
class AskSeamSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with AskApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext
  override protected def apiSystem: ActorSystem[Nothing] = typedSystem

  private val dir = Paths.get("../shared-test-fixtures/ask")

  private var owner, viewer, free, capped: String = _
  private var pid, board: String                  = _
  private var rev, cost: Output                   = _
  private var askApi: Route                       = _

  override def beforeAll(): Unit = {
    super.beforeAll(); startHarness()
    owner = seedUser("owner"); viewer = seedUser("beta"); free = seedUser("free"); capped = seedUser("beta")
    pid = seedPipelineWithOutput(owner, "table")._1
    rev = addOutput(pid, owner, "Revenue", OutputKind.Table, regionSchema)
    cost = addOutput(pid, owner, "Cost", OutputKind.Table, regionSchema)
    seedRows(pid, Seq(regionRow("east", 10)))
    board = seedBoard(owner)
    seedBoardPanel(board, owner, rev.id.value, "Revenue panel"); seedBoardPanel(board, owner, cost.id.value, "Cost panel")
    Seq(viewer, free, capped).foreach(grantBoard(board, _, "viewer"))
    val today = LocalDate.now(ZoneOffset.UTC).toString
    awaitDb(db.run(sqlu"INSERT INTO assistant_daily_usage (user_id, usage_date, message_count) VALUES (${capped}::uuid, $today::date, 100000)"))
    askApi = buildAskApi(ClaudeModelCatalog.HaikuId)
  }

  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private val question = "How do revenue and cost compare?"

  private def ask(user: String, transport: ScriptedTransport): (Int, String) = {
    switch.current = transport
    val req = HttpRequest(HttpMethods.POST, s"/api/dashboards/$board/ask", entity = HttpEntity(ContentTypes.`application/json`, JsObject("question" -> JsString(question)).compactPrint))
    var out: (Int, String) = (0, "")
    askAuthed(req, user) ~> askApi ~> check { out = (status.intValue, responseAs[String]) }
    out
  }

  private def cite(result: String, field: String): (String, JsValue) = {
    val c = citations(result).find(_.fields("field") == JsString(field)).get
    c.fields("id").convertTo[String] -> c.fields("value")
  }

  private def citedAnswer(): ScriptedTransport = new ScriptedTransport(Vector(
    _ => Seq(toolUse("t1", "get_output_rows", obj("outputId" -> JsString(rev.id.value))), toolUse("t2", "get_output_rows", obj("outputId" -> JsString(cost.id.value)))),
    r => Seq(text(lastResults(r).map { case (_, res, _) => val (id, v) = cite(res, "amount"); s"An amount is $v [$id]." }.mkString(" ")))
  ))

  private val instant = "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z".r

  private val marker = "\\[(c[0-9]+)\\]".r

  /** Generated ids to stable placeholders (in every string, keys included), instants to one fixed valid instant, and the citation
   *  ids (random per run) to c1, c2, ... in order of first use. */
  private def normalise(raw: String): JsValue = {
    val parsed = raw.parseJson
    val cites: Vector[String] = parsed match {
      case JsObject(f) => f.get("citations").collect { case JsArray(es) => es.collect { case JsObject(c) => c("id").convertTo[String] } }.getOrElse(Vector.empty)
      case _           => Vector.empty
    }
    val cmap = cites.zipWithIndex.map { case (id, i) => id -> s"c${i + 1}" }.toMap
    val ids  = Seq(rev.id.value -> "{{OUTPUT_1}}", cost.id.value -> "{{OUTPUT_2}}", pid -> "{{PIPELINE_1}}")
    def str(s: String): String = {
      val idsDone = ids.foldLeft(s) { case (acc, (id, ph)) => acc.replace(id, ph) }
      val marked  = marker.replaceAllIn(idsDone, m => Matcher.quoteReplacement(s"[${cmap.getOrElse(m.group(1), m.group(1))}]"))
      instant.replaceAllIn(marked, "2026-01-01T00:00:00Z")
    }
    def walk(v: JsValue): JsValue = v match {
      case JsString(s) => JsString(str(s))
      case JsObject(f) =>
        val renamed = if (f.contains("outputId") && f.contains("isPct")) f.updated("id", JsString(cmap(f("id").convertTo[String]))) else f
        JsObject(renamed.map { case (k, x) => str(k) -> walk(x) })
      case JsArray(e)  => JsArray(e.map(walk))
      case other       => other
    }
    walk(parsed)
  }

  private def fixture(name: String, produced: JsValue): JsValue = {
    val path = dir.resolve(name)
    if (sys.env.contains("HEL1746_WRITE_FIXTURE")) { Files.createDirectories(dir); Files.writeString(path, produced.prettyPrint + "\n") }
    Files.readString(path).parseJson
  }

  /** Validates the RAW body (real ids and instants) against the schema, then the normalised body against the committed fixture and the schema. */
  private def checkCase(name: String, schemaPath: String, status: Int, produced: (Int, String)): JsValue = {
    val schema = JsonSchemaValidation.compile(schemaPath)
    withClue(s"$name status: ")(produced._1 shouldBe status)
    withClue(s"$name raw body vs $schemaPath: ")(JsonSchemaValidation.validationErrors(schema, produced._2) shouldBe empty)
    val norm = normalise(produced._2)
    val fx   = fixture(name, norm)
    withClue(s"fixture $name differs from what the real route writes: ")(fx shouldBe norm)
    withClue(s"fixture $name vs $schemaPath: ")(JsonSchemaValidation.validationErrors(schema, fx.compactPrint) shouldBe empty)
    fx
  }

  private val ungrounded: ScriptedTransport = new ScriptedTransport(Vector(_ => Seq(text("It fell 99 percent."))))

  "the ask wire (server half)" should {
    "write a 200 with a pin for the dashboard owner, equal to the committed fixture" in {
      val fx = checkCase("ask-200-pin.json", "ask/ask-response.schema.json", 200, ask(owner, citedAnswer())).asJsObject
      fx.fields("pin") should not be JsNull
      fx.fields("citations").asInstanceOf[JsArray].elements should have size 2
      fx.fields("pin").asJsObject.fields("request").compactPrint should not include fx.fields("answer").convertTo[String]
    }

    "write a 200 with an explicit null pin for a dashboard viewer, equal to the committed fixture" in {
      val fx = checkCase("ask-200-no-pin.json", "ask/ask-response.schema.json", 200, ask(viewer, citedAnswer())).asJsObject
      fx.fields("pin") shouldBe JsNull
    }

    "write 422 ASK_UNGROUNDED, equal to the committed fixture" in {
      val fx = checkCase("ask-422-ungrounded.json", "ask/ask-ungrounded-response.schema.json", 422, ask(owner, ungrounded)).asJsObject
      fx.fields("code") shouldBe JsString("ASK_UNGROUNDED")
    }

    "write 422 ASK_ANSWER_TRUNCATED without reasons, equal to the committed fixture" in {
      val t  = new ScriptedTransport(Vector(_ => Seq(text("Cut off"))), stopReasons = Map(0 -> "max_tokens"))
      val fx = checkCase("ask-422-truncated.json", "ask/ask-truncated-response.schema.json", 422, ask(owner, t)).asJsObject
      fx.fields.keySet shouldBe Set("message", "code")
    }

    "write 403 TIER_FORBIDDEN for a free-tier grantee, equal to the committed fixture" in {
      val fx = checkCase("ask-403-tier.json", "ask/ask-tier-error-response.schema.json", 403, ask(free, citedAnswer())).asJsObject
      fx.fields("code") shouldBe JsString("TIER_FORBIDDEN")
    }

    "write 429 CHAT_LIMIT_REACHED for a beta user over the cap, equal to the committed fixture" in {
      val fx = checkCase("ask-429-limit.json", "ask/ask-tier-error-response.schema.json", 429, ask(capped, citedAnswer())).asJsObject
      fx.fields("code") shouldBe JsString("CHAT_LIMIT_REACHED")
    }
  }
}
