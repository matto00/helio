package com.helio.ai

import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.apache.pekko.NotUsed
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory

import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, Future}
import scala.jdk.CollectionConverters._

/** Coverage for `ClaudeClient` against a hand-written fake `ClaudeTransport` (HEL-390 task 6.2) —
 *  no real network call is ever made: request construction, the input-token guardrail rejection
 *  (zero transport invocations, for both `send` and `stream`), the output-token clamp, successful
 *  `usage` passthrough, API-error mapping, and that the configured API key never appears in
 *  captured log output. */
class ClaudeClientSpec extends AnyWordSpec with Matchers with ScalatestRouteTest {

  private implicit val mat: Materializer = Materializer(system)

  private def await[A](f: Future[A]): A = Await.result(f, 5.seconds)

  private def config(maxOutputTokens: Int = 4096, maxInputTokens: Int = 100000): ClaudeConfig =
    ClaudeConfig(
      apiKey = "sk-ant-test-key-should-never-be-logged",
      model = "claude-opus-4-8",
      temperature = 1.0,
      maxOutputTokens = maxOutputTokens,
      maxInputTokens = maxInputTokens
    )

  private val canned = ClaudeApiResponse(
    id = "msg_abc123",
    content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some("Hello there"))),
    stopReason = Some("end_turn"),
    usage = ClaudeApiUsage(inputTokens = 12, outputTokens = 3)
  )

  /** Hand-written fake — records every `send`/`stream` invocation and the request it was called
   *  with, so tests can assert both "was the transport called" and "with what". */
  private class FakeClaudeTransport(sendResult: => Future[ClaudeApiResponse], streamEvents: Seq[ClaudeStreamEvent] = Seq.empty)
      extends ClaudeTransport {
    val sendInvocations: AtomicInteger   = new AtomicInteger(0)
    val streamInvocations: AtomicInteger = new AtomicInteger(0)
    @volatile var lastRequest: Option[ClaudeApiRequest] = None

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = {
      sendInvocations.incrementAndGet()
      lastRequest = Some(request)
      sendResult
    }

    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = {
      streamInvocations.incrementAndGet()
      lastRequest = Some(request)
      Source(streamEvents.toList)
    }
  }

  private val request = ClaudeRequest(messages = Seq(ClaudeMessage(ClaudeRole.User, "hi")))

  "ClaudeClient.send" should {

    "wire model/max-tokens/temperature/messages through to the transport request" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxOutputTokens = 777), transport)

      val req = ClaudeRequest(
        messages = Seq(ClaudeMessage(ClaudeRole.User, "What is 2+2?")),
        maxTokens = Some(100),
        temperature = Some(0.2)
      )
      await(client.send(req))

      transport.lastRequest shouldBe Some(
        ClaudeApiRequest(
          model = "claude-opus-4-8",
          maxTokens = 100,
          messages = Seq(ClaudeApiMessage("user", "What is 2+2?")),
          temperature = 0.2,
          stream = false
        )
      )
    }

    "default maxTokens/temperature from config when the request doesn't override them" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxOutputTokens = 4096), transport)

      await(client.send(request))

      transport.lastRequest.map(_.maxTokens) shouldBe Some(4096)
      transport.lastRequest.map(_.temperature) shouldBe Some(1.0)
    }

    "clamp an over-ceiling requested maxTokens down to the ceiling rather than rejecting" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxOutputTokens = 500), transport)

      val result = await(client.send(request.copy(maxTokens = Some(10000))))

      transport.lastRequest.map(_.maxTokens) shouldBe Some(500)
      result.isRight shouldBe true
    }

    "reject over-input-budget requests with GuardrailExceeded and zero transport invocations" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxInputTokens = 1), transport)

      val longMessage = ClaudeRequest(messages = Seq(ClaudeMessage(ClaudeRole.User, "this message has more than one token in it easily")))
      val result       = await(client.send(longMessage))

      result match {
        case Left(ClaudeError.GuardrailExceeded(_)) => succeed
        case other                                   => fail(s"expected Left(GuardrailExceeded), got $other")
      }
      transport.sendInvocations.get() shouldBe 0
    }

    "proceed normally when the estimated input is at or below the budget" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxInputTokens = 100000), transport)

      val result = await(client.send(request))

      result.isRight shouldBe true
      transport.sendInvocations.get() shouldBe 1
    }

    "expose usage from the API response, not the pre-flight estimate" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(), transport)

      val result = await(client.send(request))

      result shouldBe Right(ClaudeResponse(id = "msg_abc123", text = "Hello there", stopReason = Some("end_turn"), usage = TokenUsage(12, 3)))
    }

    "map a transport ClaudeApiException to Left(ClaudeError.ApiError)" in {
      val transport = new FakeClaudeTransport(Future.failed(ClaudeApiException(401, "unauthorized")))
      val client    = new ClaudeClient(config(), transport)

      await(client.send(request)) shouldBe Left(ClaudeError.ApiError(401, "unauthorized"))
    }

    "map any other transport failure to Left(ClaudeError.TransportFailure)" in {
      val transport = new FakeClaudeTransport(Future.failed(new RuntimeException("connection refused")))
      val client    = new ClaudeClient(config(), transport)

      await(client.send(request)) shouldBe Left(ClaudeError.TransportFailure("Request failed"))
    }

    "never log the configured API key, even when the transport call fails" in {
      val secretKey  = "sk-ant-should-never-appear-in-logs-hel390"
      val transport  = new FakeClaudeTransport(Future.failed(ClaudeApiException(401, "unauthorized")))
      val clientConf = config().copy(apiKey = secretKey)
      val client     = new ClaudeClient(clientConf, transport)

      val logbackLogger = LoggerFactory.getLogger(client.getClass).asInstanceOf[LogbackLogger]
      val appender       = new ListAppender[ILoggingEvent]()
      appender.start()
      logbackLogger.addAppender(appender)

      try {
        await(client.send(request))
        val events = appender.list.asScala.toSeq
        events.foreach(_.getFormattedMessage should not include secretKey)
      } finally {
        logbackLogger.detachAppender(appender)
      }
    }
  }

  "ClaudeClient.stream" should {

    "reject over-input-budget requests with a single GuardrailExceeded error event and zero transport invocations" in {
      val transport = new FakeClaudeTransport(Future.successful(canned))
      val client    = new ClaudeClient(config(maxInputTokens = 1), transport)

      val longMessage = ClaudeRequest(messages = Seq(ClaudeMessage(ClaudeRole.User, "this message has more than one token in it easily")))
      val events       = await(client.stream(longMessage).runWith(Sink.seq))

      events should have size 1
      events.head match {
        case ClaudeStreamEvent.Error(ClaudeError.GuardrailExceeded(_)) => succeed
        case other                                                       => fail(s"expected a single GuardrailExceeded error event, got $other")
      }
      transport.streamInvocations.get() shouldBe 0
    }

    "delegate to the transport and pass through emitted events when under budget" in {
      val streamEvents = Seq(ClaudeStreamEvent.TextDelta("hi"), ClaudeStreamEvent.MessageStop)
      val transport     = new FakeClaudeTransport(Future.successful(canned), streamEvents)
      val client        = new ClaudeClient(config(), transport)

      val events = await(client.stream(request).runWith(Sink.seq))

      events shouldBe streamEvents
      transport.streamInvocations.get() shouldBe 1
    }
  }
}
