package com.helio.infrastructure.ai

import com.helio.infrastructure.ai.ClaudeFixtures._
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.{Source => StreamSource}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1636 tasks.md 5.4 (client half), 5.5, 5.6, 5.7 (client half): no-answer failures, sampling
 *  parameters, the thinking strip point and single-shot request shaping. Fixture JSON only. */
class ClaudeNoAnswerAndStripSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def config(temperature: Double = 1.0, model: String = "claude-haiku-5-5"): ClaudeConfig =
    ClaudeConfig(apiKey = "sk-ant-test-never-logged", model = model, temperature = temperature, maxOutputTokens = 4096, maxInputTokens = 100000)

  private val okExecutor = new ClaudeToolExecutor {
    def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
      Future.successful(Right("[]"))
  }

  private val userTurn = Seq(ClaudeToolMessage.text(ClaudeRole.User, "Update my Standings dashboard"))
  private val findTool = Seq(ClaudeTool("find", "find", JsObject.empty))

  private def run(transport: ClaudeTransport, webSearch: Boolean = false, cfg: ClaudeConfig = config()): ClaudeToolOutcome =
    Await.result(new ClaudeClient(cfg, transport).sendWithTools(ClaudeToolRequest(userTurn, findTool, maxHops = 4, webSearch = webSearch), okExecutor), 5.seconds)

  private def assistantContent(t: RecordingToolTransport, hop: Int, messageIndex: Int): JsValue =
    t.messagesJson(hop)(messageIndex).fields("content")

  private def containsThinkingSig(t: RecordingToolTransport, hop: Int, sig: String): Boolean =
    t.requestJson(hop).compactPrint.contains(sig)

  "sendWithTools no-answer handling (5.4)" should {
    "fail a refusal with the stop_details category" in {
      run(new RecordingToolTransport(Vector(fixture("refusal.json")))) shouldBe
        ClaudeToolOutcome.Failed(ClaudeError.NoAnswer(Some("refusal"), Some("cyber")))
    }
    "fail a thinking-only max_tokens response" in {
      run(new RecordingToolTransport(Vector(fixture("thinking-only-max-tokens.json")))) shouldBe
        ClaudeToolOutcome.Failed(ClaudeError.NoAnswer(Some("max_tokens"), None))
    }
    "keep an empty end_turn after a tool hop as a successful empty final response" in {
      val t = new RecordingToolTransport(Vector(fixture("nosearch-hop1-thinking-tooluse.json"), fixture("empty-end-turn.json")))
      run(t) match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe ""
        case other                                       => fail(s"expected FinalResponse, got $other")
      }
    }
  }

  "temperature (5.5)" should {
    "be omitted from send and tool requests at the default and sent when different" in {
      val tool = new RecordingToolTransport(Vector(textResponse("ok")))
      run(tool)
      tool.requestJson(0).fields should not contain key("temperature")
      tool.requestJson(0).compactPrint should not include "top_p"
      tool.requestJson(0).compactPrint should not include "top_k"

      val tool2 = new RecordingToolTransport(Vector(textResponse("ok")))
      // HEL-1755 C17: a catalog model (the default here) never gets sampling, so the "sent when different" half of the
      // HEL-1636 rule is about a model the catalog does not define (ClaudeModelRequestSpec covers the catalog side).
      run(tool2, cfg = config(temperature = 0.5, model = "claude-opus-4-8"))
      tool2.requestJson(0).fields("temperature") shouldBe JsNumber(0.5)
    }
  }

  "the thinking strip point (5.6)" should {
    "drop hop 1's thinking when a web search shrinks the tool list, keep its other blocks" in {
      val t = new RecordingToolTransport(Vector(fixture("strip-hop1-websearch.json"), textResponse("done")))
      run(t, webSearch = true)
      containsThinkingSig(t, 1, "SIG_S1") shouldBe false
      blockTypes(t.messagesJson(1)(1)) shouldBe Vector("server_tool_use", "web_search_tool_result", "tool_use")
    }
    "keep a later thinking block byte-exact after the strip point and never resend the stripped one" in {
      val t = new RecordingToolTransport(
        Vector(fixture("strip-hop1-websearch.json"), fixture("strip-hop2-thinking-tooluse.json"), textResponse("done"))
      )
      run(t, webSearch = true)
      containsThinkingSig(t, 2, "SIG_S1") shouldBe false
      val hop2Assistant = fixtureContent("strip-hop2-thinking-tooluse.json")
      t.messagesJson(2)(3).fields("content") shouldBe JsArray(hop2Assistant)
    }
    "keep hop 1's thinking byte-exact on hop 2 when no search happened" in {
      val t = new RecordingToolTransport(Vector(fixture("nosearch-hop1-thinking-tooluse.json"), textResponse("done")))
      run(t, webSearch = true)
      assistantContent(t, 1, 1) shouldBe JsArray(fixtureContent("nosearch-hop1-thinking-tooluse.json"))
    }
  }

  private final class RecordingSendTransport(response: ClaudeApiResponse) extends ClaudeTransport {
    val received = new ConcurrentLinkedQueue[ClaudeApiRequest]()
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = { received.add(request); Future.successful(response) }
    override def stream(request: ClaudeApiRequest): StreamSource[ClaudeStreamEvent, NotUsed] = StreamSource.empty
    def lastJson: JsObject = ClaudeProtocol.claudeApiRequestFormat.write(received.asScala.last).asJsObject
  }

  "single-shot send (5.7)" should {
    val req = ClaudeRequest(Seq(ClaudeMessage(ClaudeRole.User, "hi")))

    "fail a refusal" in {
      val c = new ClaudeClient(config(), new RecordingSendTransport(fixture("refusal.json")))
      Await.result(c.send(req), 5.seconds) shouldBe Left(ClaudeError.NoAnswer(Some("refusal"), Some("cyber")))
    }
    "fail a response with no text, whatever the stop reason" in {
      val c = new ClaudeClient(config(), new RecordingSendTransport(fixture("empty-end-turn.json")))
      Await.result(c.send(req), 5.seconds) shouldBe Left(ClaudeError.NoAnswer(Some("end_turn"), None))
    }
    "serialise no empty message and merge the user neighbours" in {
      val tr = new RecordingSendTransport(textResponse("ok"))
      val c  = new ClaudeClient(config(), tr)
      val r = ClaudeRequest(Seq(
        ClaudeMessage(ClaudeRole.User, "first"),
        ClaudeMessage(ClaudeRole.Assistant, ""),
        ClaudeMessage(ClaudeRole.User, "second")
      ))
      Await.result(c.send(r), 5.seconds).isRight shouldBe true
      val msgs = tr.lastJson.fields("messages").convertTo[Vector[JsObject]]
      msgs.size shouldBe 1
      tr.lastJson.compactPrint should include("first\\n\\nsecond")
      tr.lastJson.fields should not contain key("temperature")
    }
  }
}
