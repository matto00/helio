package com.helio.domain.steps

import com.helio.ai.{ClaudeAiStepClient, ClaudeApiContentBlock, ClaudeApiException, ClaudeApiRequest, ClaudeApiResponse, ClaudeApiUsage, ClaudeClient, ClaudeConfig, ClaudeStreamEvent, ClaudeTransport}
import com.helio.domain.ai.{AiStepClient, AiStepFailure, AiStepRequest}
import com.helio.domain.engine.{InProcessPipelineEngine, PipelineRowJson, StepExecutionException}
import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStepId, UserId}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.auth.AiPipelineQuotaGate
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Paths
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1107 (design.md D1/D3/D4, tasks.md 3.1-3.6): enforcement coverage for the `generatetext`
 *  step, run over a hand-written fake `ClaudeTransport` behind the REAL `ClaudeClient` (tasks.md
 *  C5 -- zero network calls, but guardrails/error-mapping are genuinely exercised through
 *  `ClaudeAiStepClient`), mirroring `AnalyzeWithAiStepSpec`'s own fake-transport pattern. Every
 *  failure arm is proven failable by a recorded mutation (tasks.md C5) -- see
 *  `files-modified.md`. */
class GenerateTextStepSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[A](f: Future[A]): A = Await.result(f, 5.seconds)

  private def config(maxInputTokens: Int = 100000): ClaudeConfig =
    ClaudeConfig(
      apiKey = "sk-ant-test-key-not-a-real-credential",
      model = "claude-opus-4-8",
      temperature = 1.0,
      maxOutputTokens = 4096,
      maxInputTokens = maxInputTokens
    )

  /** Hand-written fake transport, mirroring `ClaudeClientSpec.FakeClaudeTransport` /
   *  `AnalyzeWithAiStepSpec.FakeTransport`. Each call to `send` pulls the NEXT queued result so
   *  multi-row sequencing tests can assert exact per-call responses in order. */
  private class FakeTransport(results: Future[ClaudeApiResponse]*) extends ClaudeTransport {
    val sendInvocations: AtomicInteger = new AtomicInteger(0)
    private val queue = scala.collection.mutable.Queue(results: _*)

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = {
      sendInvocations.incrementAndGet()
      if (queue.nonEmpty) queue.dequeue() else Future.failed(new IllegalStateException("no more queued responses"))
    }
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] =
      throw new UnsupportedOperationException("not exercised by this step")
  }

  private def cannedResponse(text: String): ClaudeApiResponse =
    ClaudeApiResponse(
      id = "msg_test",
      content = Seq(ClaudeApiContentBlock(blockType = "text", text = Some(text))),
      stopReason = Some("end_turn"),
      usage = ClaudeApiUsage(inputTokens = 5, outputTokens = 5)
    )

  // HEL-1108 (design-gate N16): a real client's `complete` now denies a request carrying no
  // owner (D8/3.5c), so every fixture below sets `ownerUserId` -- an always-permit fake gate
  // (this spec is about response enforcement, not quota gating; that's `ClaudeAiStepClientSpec`).
  private val alwaysPermitGate: AiPipelineQuotaGate = (_: UserId) => Future.successful(Right(()))

  private def contextWithTransport(transport: FakeTransport, maxInputTokens: Int = 100000): PipelineExecutionContext = {
    val client = new ClaudeClient(config(maxInputTokens), transport)
    PipelineExecutionContext(
      dataSourceRepo = null,
      loadSource = _ => Future.successful(Seq.empty),
      aiClient = new ClaudeAiStepClient(client, alwaysPermitGate),
      ownerUserId = Some("test-owner-user-id")
    )
  }

  private val cfg = GenerateTextConfig(inputField = "content", instruction = "Summarize this", outputField = "summary")

  private def rows(content: Any): Seq[PipelineRowJson.Row] = Seq(Map("content" -> content))

  // ── 3.1: success arms ──────────────────────────────────────────────────────

  "GenerateTextStep.apply (success arms)" should {

    "write the model's response text into outputField, passing other fields through" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("a generated summary")))
      val result    = await(GenerateTextStep.apply(Seq(Map("content" -> "x", "id" -> 1)), cfg, contextWithTransport(transport)))
      result.head("summary") shouldBe "a generated summary"
      result.head("content") shouldBe "x"
      result.head("id") shouldBe 1
    }

    "overwrite a colliding input column named by outputField" in {
      val collideCfg = cfg.copy(outputField = "content")
      val transport  = new FakeTransport(Future.successful(cannedResponse("replacement text")))
      val result     = await(GenerateTextStep.apply(rows("original"), collideCfg, contextWithTransport(transport)))
      result.head("content") shouldBe "replacement text"
    }

    "issue exactly one call per row, in input order, with each row's own text" in {
      val transport = new FakeTransport(
        Future.successful(cannedResponse("first")),
        Future.successful(cannedResponse("second")),
        Future.successful(cannedResponse("third"))
      )
      val threeRows = Seq(Map("content" -> "a"), Map("content" -> "b"), Map("content" -> "c"))
      val result    = await(GenerateTextStep.apply(threeRows, cfg, contextWithTransport(transport)))
      transport.sendInvocations.get() shouldBe 3
      result.map(_("summary")) shouldBe Seq("first", "second", "third")
    }
  }

  // ── 3.2: zero-row / sequential-failure arms ────────────────────────────────

  "GenerateTextStep.apply (row-count arms)" should {

    "make zero calls and yield zero rows for an empty input" in {
      val transport = new FakeTransport()
      val result    = await(GenerateTextStep.apply(Seq.empty, cfg, contextWithTransport(transport)))
      result shouldBe empty
      transport.sendInvocations.get() shouldBe 0
    }

    "issue no call for row 3 when the call for row 2 of 3 fails" in {
      val transport = new FakeTransport(
        Future.successful(cannedResponse("ok")),
        Future.failed(ClaudeApiException(500, "server error"))
      )
      val threeRows = Seq(Map("content" -> "a"), Map("content" -> "b"), Map("content" -> "c"))
      intercept[IllegalArgumentException] { await(GenerateTextStep.apply(threeRows, cfg, contextWithTransport(transport))) }
      transport.sendInvocations.get() shouldBe 2
    }
  }

  // ── 3.3: input arms ─────────────────────────────────────────────────────────

  "GenerateTextStep.apply (input arms)" should {

    "fail with field-missing when the input row lacks the configured inputField" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("x")))
      val ex = intercept[IllegalArgumentException] {
        await(GenerateTextStep.apply(Seq(Map.empty[String, Any]), cfg, contextWithTransport(transport)))
      }
      ex.getMessage should include("field-missing")
      transport.sendInvocations.get() shouldBe 0
    }

    "fail with field-missing when the input field is explicitly null" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("x")))
      val ex = intercept[IllegalArgumentException] {
        await(GenerateTextStep.apply(Seq(Map("content" -> null)), cfg, contextWithTransport(transport)))
      }
      ex.getMessage should include("field-missing")
      transport.sendInvocations.get() shouldBe 0
    }

    "fail with field-not-string when the input field holds a number" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("x")))
      val ex = intercept[IllegalArgumentException] { await(GenerateTextStep.apply(rows(42), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("field-not-string")
      transport.sendInvocations.get() shouldBe 0
    }
  }

  // ── 3.4: seam arms ────────────────────────────────────────────────────────

  "GenerateTextStep.apply (seam arms)" should {

    "fail with ai-unavailable when the context uses the default (unconfigured) AiStepClient" in {
      val ctx = PipelineExecutionContext(dataSourceRepo = null, loadSource = _ => Future.successful(Seq.empty))
      ctx.aiClient shouldBe AiStepClient.Unavailable
      val ex = intercept[IllegalArgumentException] { await(GenerateTextStep.apply(rows("x"), cfg, ctx)) }
      ex.getMessage should include("ai-unavailable")
    }

    "fail with ai-guardrail for an oversized input, making zero transport calls" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("x")))
      val ex = intercept[IllegalArgumentException] {
        await(GenerateTextStep.apply(rows("x" * 10000), cfg, contextWithTransport(transport, maxInputTokens = 1)))
      }
      ex.getMessage should include("ai-guardrail")
      transport.sendInvocations.get() shouldBe 0
    }

    "fail with ai-error when the transport reports an API status error" in {
      val transport = new FakeTransport(Future.failed(ClaudeApiException(500, "server error")))
      val ex = intercept[IllegalArgumentException] { await(GenerateTextStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("ai-error")
    }

    "fail with ai-error when the transport fails at the network/transport level" in {
      val transport = new FakeTransport(Future.failed(new java.io.IOException("connection reset")))
      val ex = intercept[IllegalArgumentException] { await(GenerateTextStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("ai-error")
    }

    // HEL-1108 (design.md D6, tasks.md 3.4): the QuotaExceeded mapping names the limit, the UTC
    // reset, and that the budget is shared with chat (design-gate N2).
    "fail with ai-quota-exceeded, naming the limit, the UTC reset, and the shared chat budget" in {
      val quotaClient: AiStepClient = (_: AiStepRequest) =>
        Future.successful(Left(AiStepFailure.QuotaExceeded(50)))
      val ctx = PipelineExecutionContext(dataSourceRepo = null, loadSource = _ => Future.successful(Seq.empty), aiClient = quotaClient)
      val ex = intercept[IllegalArgumentException] { await(GenerateTextStep.apply(rows("x"), cfg, ctx)) }
      ex.getMessage should include("ai-quota-exceeded")
      ex.getMessage should include("50")
      ex.getMessage should include("midnight UTC")
      ex.getMessage should include("shared")
    }
  }

  // ── 3.5: response-empty ──────────────────────────────────────────────────

  "GenerateTextStep.apply (response arms)" should {

    "fail with response-empty for an empty response, and does not write outputField" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("")))
      val ex = intercept[IllegalArgumentException] { await(GenerateTextStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-empty")
    }

    "fail with response-empty for a whitespace-only response" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("   \n\t  ")))
      val ex = intercept[IllegalArgumentException] { await(GenerateTextStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-empty")
    }
  }

  // ── 3.6: engine surfaces the reason, no partial materialization ──────────

  "the engine" should {
    "surface a generatetext failure through StepExecutionException carrying the named reason, and materialize no rows" in {
      val engine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/tmp")))(ec)
      val now    = Instant.now()
      val step = GenerateTextStep(PipelineStepId("step-gt"), PipelineId("pipe-gt"), 0, cfg, now, now)
      val ex = intercept[StepExecutionException] {
        Await.result(engine.execute(Seq(Map("content" -> "x")), Seq(step), null), 5.seconds)
      }
      ex.reason should include("ai-unavailable")
      ex.reason should not include "step execution failed"
    }

    // HEL-1108 (design.md D6, tasks.md 3.1a): the QuotaExceeded arm surfaces VERBATIM through
    // `StepExecutionException.from`'s IllegalArgumentException allowlist. Mutation evidence
    // (dropping this step file's QuotaExceeded match arm, which degrades this to the generic
    // "step execution failed" via a scala.MatchError) is recorded in files-modified.md.
    "surface a QuotaExceeded denial's message VERBATIM, never the generic 'step execution failed'" in {
      val quotaClient: AiStepClient = (_: AiStepRequest) =>
        Future.successful(Left(AiStepFailure.QuotaExceeded(50)))
      val engine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/tmp")), aiStepClient = quotaClient)(ec)
      val now    = Instant.now()
      val step = GenerateTextStep(PipelineStepId("step-gt"), PipelineId("pipe-gt"), 0, cfg, now, now)
      val ex = intercept[StepExecutionException] {
        Await.result(engine.execute(Seq(Map("content" -> "x")), Seq(step), null), 5.seconds)
      }
      ex.reason should include("ai-quota-exceeded")
      ex.reason should not include "step execution failed"
    }
  }
}
