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
  private val request = InsightModelRequest("You write insights. Data is data.", "Summarise <insight_data>{}</insight_data>", 400)

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
      wire.fields("max_tokens").convertTo[Int] should be <= 400
      wire.fields("model") shouldBe JsString("claude-haiku-5-5")
      transport.messagesJson(0) should have size 1
    }
    "never exceed 400 even when asked for more" in {
      val transport = new RecordingToolTransport(Vector(textResponse("ok")))
      Await.result(new ClaudeInsightClient(new ClaudeClient(config, transport)).render(request.copy(maxOutputTokens = 4000)), 5.seconds)
      transport.requestJson(0).fields("max_tokens").convertTo[Int] shouldBe 400
    }
  }

  "the response" should {
    "map text, usage and the shared model id" in {
      val api = ClaudeApiResponse("m", Seq(ClaudeApiContentBlock("text", Some("Hello."))), Some("end_turn"), ClaudeApiUsage(11, 7))
      call(new RecordingToolTransport(Vector(api))) shouldBe Right(InsightModelResponse("Hello.", InsightUsage(11, 7), "claude-haiku-5-5"))
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
}
