package com.helio.infrastructure.ai

import com.helio.infrastructure.ai.ClaudeFixtures._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1636 tasks.md 5.2 / 5.3 (design D3, D5). Hand-built, secret-free fixtures; the transport is
 *  a recording fake, so no real network call is made. */
class ClaudeThinkingRoundTripSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def config(): ClaudeConfig =
    ClaudeConfig(apiKey = "sk-ant-test-never-logged", model = "claude-haiku-5-5", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)

  private val okExecutor = new ClaudeToolExecutor {
    def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
      Future.successful(Right("[]"))
  }

  private def run(transport: RecordingToolTransport, history: Seq[ClaudeToolMessage]): ClaudeToolOutcome = {
    val client = new ClaudeClient(config(), transport)
    Await.result(client.sendWithTools(ClaudeToolRequest(history, Seq(ClaudeTool("find", "find", JsObject.empty)), maxHops = 3), okExecutor), 5.seconds)
  }

  private val userTurn = ClaudeToolMessage.text(ClaudeRole.User, "Update my Standings dashboard")

  "sendWithTools (HEL-1636 5.2)" should {

    "send hop 1's thinking, redacted_thinking and tool_use back unchanged on hop 2" in {
      val hop1      = "haiku55-thinking-redacted-tooluse.json"
      val transport = new RecordingToolTransport(Vector(fixture(hop1), textResponse("All done.")))

      run(transport, Seq(userTurn)) shouldBe a[ClaudeToolOutcome.FinalResponse]
      transport.invocations shouldBe 2

      val hop2Messages = transport.messagesJson(1)
      val assistantMsg = hop2Messages(1)
      assistantMsg.fields("role") shouldBe JsString("assistant")
      // Same blocks, same order, same fields: empty `thinking` kept, signature and data exact.
      assistantMsg.fields("content") shouldBe JsArray(fixtureContent(hop1))
      blockTypes(assistantMsg) shouldBe Vector("thinking", "redacted_thinking", "tool_use")
      emptyTextBlocks(transport.requestJson(1)) shouldBe empty
    }
  }

  "ClaudeClient block handling (HEL-1636 5.3 guard)" should {

    "never turn an unknown block type into an empty text block, and send it back verbatim in-loop" in {
      val hop1      = "unknown-block-then-tooluse.json"
      val transport = new RecordingToolTransport(Vector(fixture(hop1), textResponse("ok")))

      val outcome = run(transport, Seq(userTurn))
      outcome shouldBe a[ClaudeToolOutcome.FinalResponse]

      val assistantMsg = transport.messagesJson(1)(1)
      assistantMsg.fields("content") shouldBe JsArray(fixtureContent(hop1))
      emptyTextBlocks(transport.requestJson(1)) shouldBe empty

      val history = outcome.asInstanceOf[ClaudeToolOutcome.FinalResponse].history
      history.flatMap(_.content).collect { case ClaudeContentBlock.Text(t) => t } should not contain ""
    }

    "never serialise an empty text block from legacy Text(\"\") history" in {
      val legacy = Seq(
        userTurn,
        ClaudeToolMessage(ClaudeRole.Assistant, Seq(ClaudeContentBlock.Text(""), ClaudeContentBlock.Text("Hello"))),
        ClaudeToolMessage.text(ClaudeRole.User, "next question")
      )
      val transport = new RecordingToolTransport(Vector(textResponse("fine")))

      run(transport, legacy) shouldBe a[ClaudeToolOutcome.FinalResponse]

      emptyTextBlocks(transport.requestJson(0)) shouldBe empty
      transport.requestJson(0).compactPrint should include("Hello")
    }

    "drop a legacy assistant turn that holds only an empty text block, merging its user neighbours" in {
      val legacy = Seq(
        userTurn,
        ClaudeToolMessage(ClaudeRole.Assistant, Seq(ClaudeContentBlock.Text(""))),
        ClaudeToolMessage.text(ClaudeRole.User, "second message")
      )
      val transport = new RecordingToolTransport(Vector(textResponse("fine")))

      run(transport, legacy)

      val roles = transport.messagesJson(0).map(_.fields("role").convertTo[String])
      roles shouldBe Vector("user")
      emptyTextBlocks(transport.requestJson(0)) shouldBe empty
    }
  }
}
