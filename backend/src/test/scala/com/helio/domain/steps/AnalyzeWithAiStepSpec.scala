package com.helio.domain.steps

import com.helio.infrastructure.ai.{ClaudeAiStepClient, ClaudeApiContentBlock, ClaudeApiException, ClaudeApiRequest, ClaudeApiResponse, ClaudeApiUsage, ClaudeClient, ClaudeConfig, ClaudeStreamEvent, ClaudeTransport}
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

/** HEL-1106 (design.md D5/D6, tasks.md 3.1-3.3): enforcement coverage for the `analyzewithai`
 *  step, run over a hand-written fake `ClaudeTransport` behind the REAL `ClaudeClient` (tasks.md
 *  C3 -- zero network calls, but guardrails/error-mapping are genuinely exercised through
 *  `ClaudeAiStepClient`), mirroring `ClaudeClientSpec`'s own fake-transport pattern. Every
 *  enforcement failure arm is proven failable by a recorded mutation (tasks.md C4) -- see
 *  `files-modified.md`. */
class AnalyzeWithAiStepSpec extends AnyWordSpec with Matchers {

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

  /** Hand-written fake transport, mirroring `ClaudeClientSpec.FakeClaudeTransport`. */
  private class FakeTransport(sendResult: => Future[ClaudeApiResponse]) extends ClaudeTransport {
    val sendInvocations: AtomicInteger = new AtomicInteger(0)

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] = {
      sendInvocations.incrementAndGet()
      sendResult
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

  private val outputSchema = Vector(
    AnalyzeWithAiOutputField("sentiment", "string"),
    AnalyzeWithAiOutputField("score", "float")
  )
  private val cfg = AnalyzeWithAiConfig(inputField = "content", instruction = "Classify sentiment", outputSchema = outputSchema)

  private def rows(content: Any): Seq[PipelineRowJson.Row] = Seq(Map("content" -> content))

  // ── 3.1: response enforcement ─────────────────────────────────────────────

  "AnalyzeWithAiStep.apply (response enforcement)" should {

    "accept a conforming response and append the declared columns, typed as declared, in declared order" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("""{"score":0.5,"sentiment":"positive"}""")))
      val result    = await(AnalyzeWithAiStep.apply(rows("great product"), cfg, contextWithTransport(transport)))
      result.head.keys.toVector.takeRight(2) shouldBe Vector("sentiment", "score")
      result.head("sentiment") shouldBe "positive"
      result.head("score") shouldBe 0.5
    }

    "fail with response-missing-field when the response omits a declared key" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("""{"sentiment":"positive"}""")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-missing-field")
    }

    "fail with response-missing-field when a declared key is present but JSON null" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("""{"sentiment":"positive","score":null}""")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-missing-field")
    }

    "fail with response-wrong-type when a declared string key holds a number" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("""{"sentiment":1,"score":0.5}""")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-wrong-type")
    }

    "fail with response-wrong-type when a declared float key holds a string" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("""{"sentiment":"positive","score":"0.5"}""")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-wrong-type")
    }

    "fail with response-wrong-type when a declared integer key holds a fractional number" in {
      val intCfg    = cfg.copy(outputSchema = Vector(AnalyzeWithAiOutputField("count", "integer")))
      val transport = new FakeTransport(Future.successful(cannedResponse("""{"count":1.5}""")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), intCfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-wrong-type")
    }

    "fail with response-wrong-type when a declared boolean key holds a string" in {
      val boolCfg   = cfg.copy(outputSchema = Vector(AnalyzeWithAiOutputField("flag", "boolean")))
      val transport = new FakeTransport(Future.successful(cannedResponse("""{"flag":"true"}""")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), boolCfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-wrong-type")
    }

    "fail with response-extra-field when the response includes an undeclared key" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("""{"sentiment":"positive","score":0.5,"extra":"x"}""")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-extra-field")
    }

    "fail with response-malformed-json for unparseable JSON" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("""not json at all""")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-malformed-json")
    }

    "fail with response-malformed-json for a valid object followed by trailing content" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("""{"sentiment":"positive","score":0.5} trailing garbage""")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-malformed-json")
    }

    "fail with response-not-object when the response is a JSON array" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("""["positive", 0.5]""")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("response-not-object")
    }

    "accept a response wrapped in exactly one markdown code fence" in {
      val fenced    = "```json\n{\"sentiment\":\"positive\",\"score\":0.5}\n```"
      val transport = new FakeTransport(Future.successful(cannedResponse(fenced)))
      val result    = await(AnalyzeWithAiStep.apply(rows("x"), cfg, contextWithTransport(transport)))
      result.head("sentiment") shouldBe "positive"
    }
  }

  // ── 3.2: input / client-failure arms ──────────────────────────────────────

  "AnalyzeWithAiStep.apply (input and client failures)" should {

    "fail with field-missing when the input row lacks the configured inputField" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("{}")))
      val ex = intercept[IllegalArgumentException] {
        await(AnalyzeWithAiStep.apply(Seq(Map.empty[String, Any]), cfg, contextWithTransport(transport)))
      }
      ex.getMessage should include("field-missing")
      transport.sendInvocations.get() shouldBe 0
    }

    "fail with field-not-string when the input field is present but not a string" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("{}")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows(42), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("field-not-string")
      transport.sendInvocations.get() shouldBe 0
    }

    "fail with ai-unavailable when the context uses the default (unconfigured) AiStepClient" in {
      val ctx = PipelineExecutionContext(dataSourceRepo = null, loadSource = _ => Future.successful(Seq.empty))
      ctx.aiClient shouldBe AiStepClient.Unavailable
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, ctx)) }
      ex.getMessage should include("ai-unavailable")
    }

    "fail with ai-guardrail for an oversized input, making zero transport calls" in {
      val transport = new FakeTransport(Future.successful(cannedResponse("{}")))
      val ex = intercept[IllegalArgumentException] {
        await(AnalyzeWithAiStep.apply(rows("x" * 10000), cfg, contextWithTransport(transport, maxInputTokens = 1)))
      }
      ex.getMessage should include("ai-guardrail")
      transport.sendInvocations.get() shouldBe 0
    }

    "fail with ai-error when the transport reports an API error" in {
      val transport = new FakeTransport(Future.failed(ClaudeApiException(500, "server error")))
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, contextWithTransport(transport))) }
      ex.getMessage should include("ai-error")
    }

    // HEL-1108 (design.md D6, tasks.md 3.4): the QuotaExceeded mapping names the limit, the UTC
    // reset, and that the budget is shared with chat (design-gate N2).
    "fail with ai-quota-exceeded, naming the limit, the UTC reset, and the shared chat budget" in {
      val quotaClient: AiStepClient = (_: AiStepRequest) =>
        Future.successful(Left(AiStepFailure.QuotaExceeded(50)))
      val ctx = PipelineExecutionContext(dataSourceRepo = null, loadSource = _ => Future.successful(Seq.empty), aiClient = quotaClient)
      val ex = intercept[IllegalArgumentException] { await(AnalyzeWithAiStep.apply(rows("x"), cfg, ctx)) }
      ex.getMessage should include("ai-quota-exceeded")
      ex.getMessage should include("50")
      ex.getMessage should include("midnight UTC")
      ex.getMessage should include("shared")
    }
  }

  // ── 3.3: engine surfaces the reason, no partial materialization ──────────

  "the engine" should {
    "surface an analyzewithai failure through StepExecutionException carrying the named reason, and materialize no rows" in {
      val engine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/tmp")))(ec)
      val now    = Instant.now()
      val step = AnalyzeWithAiStep(PipelineStepId("step-ai"), PipelineId("pipe-ai"), 0, cfg, now, now)
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
      val step = AnalyzeWithAiStep(PipelineStepId("step-ai"), PipelineId("pipe-ai"), 0, cfg, now, now)
      val ex = intercept[StepExecutionException] {
        Await.result(engine.execute(Seq(Map("content" -> "x")), Seq(step), null), 5.seconds)
      }
      ex.reason should include("ai-quota-exceeded")
      ex.reason should not include "step execution failed"
    }
  }
}
