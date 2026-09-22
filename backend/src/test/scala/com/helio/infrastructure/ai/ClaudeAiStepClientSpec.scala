package com.helio.infrastructure.ai

import com.helio.domain.ai.{AiStepFailure, AiStepRequest}
import com.helio.domain.model.UserId
import com.helio.services.auth.AiPipelineQuotaGate
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1108 (design.md D1/D3/D6/D8, tasks.md 3.3/3.5c/4.1/4.2/4.3): coverage for the tier-gate
 *  enforcement at `ClaudeAiStepClient.complete` -- BEFORE any transport call, keyed on
 *  `request.ownerUserId`, using a hand-written fake `AiPipelineQuotaGate` and fake `ClaudeTransport`
 *  (tasks.md C4, zero network). `AnalyzeWithAiStepSpec`/`GenerateTextStepSpec` cover response
 *  enforcement with an always-permit gate; this spec is the gate's own coverage. */
class ClaudeAiStepClientSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[A](f: Future[A]): A = Await.result(f, 5.seconds)

  private def config(): ClaudeConfig =
    ClaudeConfig(
      apiKey = "sk-ant-test-key-not-a-real-credential",
      model = "claude-opus-4-8",
      temperature = 1.0,
      maxOutputTokens = 4096,
      maxInputTokens = 100000
    )

  private class CountingTransport extends ClaudeTransport {
    val sendInvocations: AtomicInteger = new AtomicInteger(0)
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = {
      sendInvocations.incrementAndGet()
      Future.successful(ClaudeApiResponse(
        id = "msg_test",
        content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some("ok"))),
        stopReason = Some("end_turn"),
        usage = ClaudeApiUsage(inputTokens = 1, outputTokens = 1)
      ))
    }
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] =
      throw new UnsupportedOperationException("not exercised by this spec")
  }

  /** Denies every call, carrying `limit` -- the mutation target for 4.2 (flip to always-permit
   *  and confirm the zero-transport-call assertions go red). */
  private class DenyingGate(limit: Int = 50) extends AiPipelineQuotaGate {
    val checkInvocations: AtomicInteger = new AtomicInteger(0)
    override def checkAndIncrement(ownerUserId: UserId): Future[Either[Int, Unit]] = {
      checkInvocations.incrementAndGet()
      Future.successful(Left(limit))
    }
  }

  private class PermittingGate extends AiPipelineQuotaGate {
    val checkInvocations: AtomicInteger = new AtomicInteger(0)
    override def checkAndIncrement(ownerUserId: UserId): Future[Either[Int, Unit]] = {
      checkInvocations.incrementAndGet()
      Future.successful(Right(()))
    }
  }

  private def request(ownerUserId: Option[String] = Some("owner-1")): AiStepRequest =
    AiStepRequest(instruction = "do the thing", content = "row content", ownerUserId = ownerUserId)

  "ClaudeAiStepClient.complete" should {

    "deny with QuotaExceeded(limit) and issue ZERO transport calls when the gate denies" in {
      val transport = new CountingTransport
      val gate      = new DenyingGate(limit = 50)
      val client    = new ClaudeAiStepClient(new ClaudeClient(config(), transport), gate)

      val result = await(client.complete(request()))
      result shouldBe Left(AiStepFailure.QuotaExceeded(50))
      transport.sendInvocations.get() shouldBe 0
    }

    "permit and reach the transport when the gate allows" in {
      val transport = new CountingTransport
      val gate      = new PermittingGate
      val client    = new ClaudeAiStepClient(new ClaudeClient(config(), transport), gate)

      val result = await(client.complete(request()))
      result shouldBe Right("ok")
      transport.sendInvocations.get() shouldBe 1
    }

    // HEL-1108 (design.md D8/3.5c, tasks.md 4.1): mutation evidence for this arm is recorded in
    // files-modified.md -- the assertion below is failable by reverting `ClaudeAiStepClient`'s
    // `case None => ...` arm to instead fall through to the gate (which would treat a no-owner
    // request as exempt rather than denied).
    "deny a request carrying no owner with ZERO model calls and WITHOUT consulting the gate" in {
      val transport = new CountingTransport
      val gate      = new PermittingGate
      val client    = new ClaudeAiStepClient(new ClaudeClient(config(), transport), gate)

      val result = await(client.complete(request(ownerUserId = None)))
      result shouldBe a[Left[_, _]]
      result.left.toOption.get shouldBe a[AiStepFailure.Unavailable]
      transport.sendInvocations.get() shouldBe 0
      gate.checkInvocations.get() shouldBe 0
    }

    // 4.3: QuotaExceeded is distinguishable from the other four AiStepFailure variants.
    "return a QuotaExceeded distinct from Unavailable/Guardrail/Api/Transport" in {
      val transport = new CountingTransport
      val gate      = new DenyingGate(limit = 7)
      val client    = new ClaudeAiStepClient(new ClaudeClient(config(), transport), gate)

      val result = await(client.complete(request()))
      val failure = result.left.toOption.get
      failure shouldBe a[AiStepFailure.QuotaExceeded]
      failure should not be a[AiStepFailure.Unavailable]
      failure should not be a[AiStepFailure.Guardrail]
      failure should not be a[AiStepFailure.Api]
      failure should not be a[AiStepFailure.Transport]
    }
  }
}
