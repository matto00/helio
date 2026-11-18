package com.helio.infrastructure.ai

import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.helio.infrastructure.ai.ClaudeFixtures._
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1755 tasks.md 5.3: the per-request model reaches the wire as the catalog's own id, a catalog model never
 *  carries a sampling/thinking-budget/forced-tool field whatever the caller or config says, and the response's own
 *  `model` is decoded, carried on the outcome and logged. */
class ClaudeModelRequestSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val Forbidden = Set("temperature", "top_p", "top_k", "budget_tokens", "tool_choice", "thinking")

  private def config(model: String, temperature: Double = 1.0): ClaudeConfig =
    ClaudeConfig("sk-ant-test-never-logged", model, temperature, 4096, 100000)

  private def spec(id: String): ClaudeModelSpec = ClaudeModelCatalog.all.select(id).get

  private def keysDeep(v: JsValue): Set[String] = v match {
    case o: JsObject => o.fields.keySet ++ o.fields.values.flatMap(keysDeep)
    case JsArray(es) => es.flatMap(keysDeep).toSet
    case _           => Set.empty
  }

  private val executor: ClaudeToolExecutor = new ClaudeToolExecutor {
    def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = Future.successful(Right("[]"))
  }

  private def run(client: ClaudeClient, request: ClaudeToolRequest): ClaudeToolOutcome =
    Await.result(client.sendWithTools(request, executor), 5.seconds)

  private def toolRequest(model: Option[ClaudeModelSpec], temperature: Option[Double] = None) =
    ClaudeToolRequest(Seq(ClaudeToolMessage.text(ClaudeRole.User, "hi")), Seq.empty, maxHops = 2, temperature = temperature, model = model)

  "sendWithTools for a catalog model" should {
    for (id <- Seq("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5")) {
      s"send $id as the wire model and no sampling, thinking-budget or forced-tool field, even with an explicit temperature ($id)" in {
        val transport = new RecordingToolTransport(Vector(textResponse("ok")))
        // The config default is a non-catalog id and CLAUDE_TEMPERATURE is non-default: neither may leak onto the wire.
        val client = new ClaudeClient(config("claude-opus-4-8", temperature = 0.4), transport)
        run(client, toolRequest(Some(spec(id)), temperature = Some(0.2)))
        transport.requests.map(_.model) shouldBe Vector(id)
        transport.requests.head.temperature shouldBe None
        keysDeep(transport.requestJson(0)).intersect(Forbidden) shouldBe empty
      }
    }

    "apply the rules to a catalog server default carried only by config.model, with no per-request model" in {
      val transport = new RecordingToolTransport(Vector(textResponse("ok")))
      run(new ClaudeClient(config("claude-sonnet-5-5", temperature = 0.4), transport), toolRequest(None, temperature = Some(0.2)))
      transport.requests.head.model shouldBe "claude-sonnet-5-5"
      transport.requests.head.temperature shouldBe None
    }

    "keep today's HEL-1636 temperature rule for a model the catalog does not define" in {
      val transport = new RecordingToolTransport(Vector(textResponse("ok"), textResponse("ok")))
      val client    = new ClaudeClient(config("claude-opus-4-8"), transport)
      run(client, toolRequest(None, temperature = Some(0.2)))
      run(client, toolRequest(None))
      transport.requests.map(_.temperature) shouldBe Vector(Some(0.2), None)
    }
  }

  "send (the non-tool path) for a catalog model" should {
    "send the catalog id and no temperature" in {
      var seen: Option[ClaudeApiRequest] = None
      val transport = new ClaudeTransport {
        def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = { seen = Some(request); Future.successful(textResponse("ok")) }
        def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException
        override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = throw new UnsupportedOperationException
      }
      val client = new ClaudeClient(config("claude-opus-4-8", temperature = 0.4), transport)
      Await.result(client.send(ClaudeRequest(Seq(ClaudeMessage(ClaudeRole.User, "hi")), temperature = Some(0.2), model = Some(spec("claude-haiku-5-5")))), 5.seconds)
      seen.map(_.model) shouldBe Some("claude-haiku-5-5")
      seen.flatMap(_.temperature) shouldBe None
    }
  }

  "the response model" should {
    "be decoded from the wire body" in {
      val body = """{"id":"msg_1","model":"claude-haiku-5-5","content":[{"type":"text","text":"x"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}"""
      body.parseJson.convertTo[ClaudeApiResponse](ClaudeProtocol.claudeApiResponseFormat).model shouldBe Some("claude-haiku-5-5")
      """{"id":"m","content":[],"usage":{"input_tokens":1,"output_tokens":1}}""".parseJson
        .convertTo[ClaudeApiResponse](ClaudeProtocol.claudeApiResponseFormat).model shouldBe None
    }

    "ride the final outcome and log one correlated INFO line (request-id, ids, stop_reason, block types only)" in {
      val logger   = LoggerFactory.getLogger(classOf[ClaudeClient]).asInstanceOf[LogbackLogger]
      val appender = new ListAppender[ILoggingEvent]()
      appender.start(); logger.addAppender(appender)
      try {
        val response  = textResponse("SECRET-ANSWER-TEXT").copy(model = Some("claude-haiku-5-5"), requestId = Some("req_abc123"))
        val transport = new RecordingToolTransport(Vector(response))
        val outcome   = run(new ClaudeClient(config("claude-opus-4-8"), transport), toolRequest(Some(spec("claude-haiku-5-5"))))
        outcome match {
          case f: ClaudeToolOutcome.FinalResponse => f.responseModel shouldBe Some("claude-haiku-5-5")
          case other                              => fail(s"expected FinalResponse, got $other")
        }
        val lines = appender.list.asScala.map(_.getFormattedMessage).filter(_.startsWith("Claude hop")).toVector
        lines should have size 1
        lines.head should (include("request-id=req_abc123") and include("requested=claude-haiku-5-5") and
          include("response-model=claude-haiku-5-5") and include("stop_reason=end_turn") and include("blocks=[text]"))
        lines.head should not include "SECRET-ANSWER-TEXT"
        appender.list.asScala.filter(_.getLevel.toString == "WARN") shouldBe empty
      } finally logger.detachAppender(appender)
    }

    "WARN once, naming only the two ids, when the response model differs from the pinned one" in {
      val logger   = LoggerFactory.getLogger(classOf[ClaudeClient]).asInstanceOf[LogbackLogger]
      val appender = new ListAppender[ILoggingEvent]()
      appender.start(); logger.addAppender(appender)
      try {
        val response = textResponse("ok").copy(model = Some("claude-opus-5-5"))
        run(new ClaudeClient(config("claude-opus-4-8"), new RecordingToolTransport(Vector(response))), toolRequest(Some(spec("claude-haiku-5-5"))))
        val warns = appender.list.asScala.filter(_.getLevel.toString == "WARN").map(_.getFormattedMessage).toVector
        warns should have size 1
        warns.head should (include("claude-opus-5-5") and include("claude-haiku-5-5"))
      } finally logger.detachAppender(appender)
    }
  }
}
