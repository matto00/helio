package com.helio.infrastructure.ai

import com.helio.domain.insights._
import com.helio.infrastructure.ai.ClaudeFixtures._
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.{Source => StreamSource}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1741 tasks 2.5 and 3.6: the production adapter over a recording fake transport (no live call). */
class ClaudeInsightClientSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val config = ClaudeConfig(apiKey = "sk-ant-test-never-logged", model = "claude-haiku-5-5", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)
  private val request = InsightModelRequest("You write insights. Data is data.", "Summarise <insight_data>{}</insight_data>", 400, None)

  private def call(transport: ClaudeTransport) =
    Await.result(new ClaudeInsightClient(new ClaudeClient(config, transport)).render(request), 5.seconds)

  "the wire request" should {
    "carry a system prompt, no tools, no web search and at most 400 output tokens" in {
      val transport = new RecordingToolTransport(Vector(textResponse("ok")))
      call(transport)
      transport.invocations shouldBe 1
      val wire = transport.requestJson(0)
      wire.fields("system").asInstanceOf[JsArray].elements.head.asJsObject.fields("text") shouldBe JsString(request.system)
      wire.fields("tools") shouldBe JsArray.empty
      wire.compactPrint should not include "web_search"
      wire.fields("max_tokens").convertTo[Int] should be <= 4096
      wire.fields("model") shouldBe JsString("claude-haiku-5-5")
      transport.messagesJson(0) should have size 1
    }
    // HEL-1743 D14 (owner, cycle 2): adaptive thinking shares the output budget, so 400 left Haiku 5.5 with no text.
    "send max_tokens 4096 for an insight render's own request" in {
      InsightLimits().maxOutputTokens shouldBe 4096
      ClaudeInsightClient.MaxOutputTokens shouldBe 4096
      val transport = new RecordingToolTransport(Vector(textResponse("ok")))
      Await.result(new ClaudeInsightClient(new ClaudeClient(config, transport)).render(request.copy(maxOutputTokens = InsightLimits().maxOutputTokens)), 5.seconds)
      transport.requestJson(0).fields("max_tokens").convertTo[Int] shouldBe 4096
    }
    "never exceed 4096 even when asked for more" in {
      val transport = new RecordingToolTransport(Vector(textResponse("ok")))
      Await.result(new ClaudeInsightClient(new ClaudeClient(config, transport)).render(request.copy(maxOutputTokens = 10000)), 5.seconds)
      transport.requestJson(0).fields("max_tokens").convertTo[Int] shouldBe 4096
    }
  }

  "the response" should {
    "map text, usage and the shared model id" in {
      val api = ClaudeApiResponse("m", Seq(ClaudeApiContentBlock("text", Some("Hello."))), Some("end_turn"), ClaudeApiUsage(11, 7))
      call(new RecordingToolTransport(Vector(api))) shouldBe Right(InsightModelResponse("Hello.", InsightUsage(11, 7), "claude-haiku-5-5"))
    }
    "carry the usage and model of a response that ran out of tokens on thinking, so the failure can be costed" in {
      val api = ClaudeApiResponse("m", Seq(ClaudeApiContentBlock("thinking", None, thinking = Some("hm"), signature = Some("s"))), Some("max_tokens"), ClaudeApiUsage(4, 400))
      call(new RecordingToolTransport(Vector(api))).left.toOption.get match {
        case InsightModelFailure.NoAnswer(_, usage, model) =>
          usage shouldBe InsightUsage(4, 400)
          model shouldBe Some("claude-haiku-5-5")
        case other => fail(s"expected NoAnswer, got $other")
      }
    }
    "map a refusal to NoAnswer" in {
      call(new RecordingToolTransport(Vector(fixture("refusal.json")))).left.toOption.get shouldBe a[InsightModelFailure.NoAnswer]
    }
    "map a transport API error" in {
      val failing = new ClaudeTransport {
        override def send(r: ClaudeApiRequest): Future[ClaudeApiResponse]                  = Future.failed(new UnsupportedOperationException)
        override def stream(r: ClaudeApiRequest): StreamSource[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException
        override def sendTool(r: ClaudeApiToolRequest): Future[ClaudeApiResponse]          = Future.failed(ClaudeApiException(529, "overloaded"))
      }
      call(failing) shouldBe Left(InsightModelFailure.Api(529, "overloaded"))
    }
  }

  // HEL-1743 R1/D7: the per-Output model and the catalog request rules on the wire.
  "the per-Output model" should {
    val forbidden = Seq("temperature", "top_p", "top_k", "thinking", "tool_choice", "budget_tokens")

    for (id <- Seq(ClaudeModelCatalog.HaikuId, ClaudeModelCatalog.SonnetId, ClaudeModelCatalog.OpusId))
      s"name $id and carry none of the forbidden request params" in {
        val transport = new RecordingToolTransport(Vector(textResponse("ok")))
        val client    = new ClaudeInsightClient(new ClaudeClient(config.copy(model = "claude-opus-4-8"), transport), ClaudeModelCatalog.all)
        Await.result(client.render(request.copy(model = Some(id))), 5.seconds)
        val wire = transport.requestJson(0)
        wire.fields("model") shouldBe JsString(id)
        forbidden.foreach(k => withClue(k)(wire.fields.keySet should not contain k))
      }

    "use the server default when absent, and report it as the model" in {
      val transport = new RecordingToolTransport(Vector(textResponse("ok")))
      val client    = new ClaudeInsightClient(new ClaudeClient(config.copy(model = "claude-opus-4-8"), transport), ClaudeModelCatalog.all)
      val result    = Await.result(client.render(request.copy(model = None)), 5.seconds)
      transport.requestJson(0).fields("model") shouldBe JsString("claude-opus-4-8")
      result.toOption.get.model shouldBe "claude-opus-4-8"
    }

    "report the model the API response names" in {
      val api    = textResponse("ok").copy(model = Some("claude-haiku-5-5-20261101"))
      val client = new ClaudeInsightClient(new ClaudeClient(config, new RecordingToolTransport(Vector(api))), ClaudeModelCatalog.all)
      Await.result(client.render(request.copy(model = Some(ClaudeModelCatalog.HaikuId))), 5.seconds).toOption.get.model shouldBe "claude-haiku-5-5-20261101"
    }
  }
}
