package com.helio.domain.steps

import com.helio.domain.ai.{AiQuotaMessage, AiStepFailure, AiStepRequest}
import com.helio.domain.engine.PipelineRowJson
import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId, StepGroup}
import spray.json._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1107 (design.md D1/D3/D4) -- the second AI pipeline step: for every input row, sends
 *  `cfg.instruction` plus the row's `cfg.inputField` content to the model (through
 *  `ctx.aiClient`, never `ClaudeClient` directly -- design.md's shared seam from HEL-1106), and
 *  writes the raw response text to `cfg.outputField`. Unlike `analyzewithai`, there is no
 *  declared output schema to enforce: the deliverable IS prose (design.md D3), so the only
 *  response-level check is non-blank. Runs ONE call per row, SEQUENTIALLY, owner-ruled per-row
 *  only (design.md D1/tasks.md C3) -- no batching, no N-to-1 collapse, no mode toggle. The whole
 *  run fails on the first bad row -- `outputField` is written only after the non-blank check, so
 *  a partially-written row is unreachable by construction (design.md D4). HEL-1108's tier/quota
 *  gating is enforced at `ClaudeAiStepClient.complete` -- `ctx.aiClient.complete` remains the
 *  single model call point that gate lives behind, and this file only maps its `QuotaExceeded`
 *  denial to a named failure. */
final case class GenerateTextStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: GenerateTextConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = GenerateTextStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    GenerateTextStep.apply(rows, config, ctx)
}

object GenerateTextStep {
  val Kind: String = "generatetext"

  /** design.md D4 -- every named failure reason, prefixed onto the `IllegalArgumentException`
   *  message so `StepExecutionException.from`'s allowlist (an `IllegalArgumentException`'s
   *  `getMessage` is kept verbatim) surfaces it to the run's error unmodified, mirroring
   *  `AnalyzeWithAiStep.fail`/`ConvertFormatStep.fail`. */
  private def fail(code: String, detail: String): Nothing =
    throw new IllegalArgumentException(s"generatetext $code: $detail")

  /** Sequential per-row evaluation (design.md D1, owner ruling): rows are folded left-to-right
   *  through the model call so a failure on row N never issues a call for row N+1, and a zero-row
   *  input issues zero calls and yields zero rows. */
  def apply(rows: Seq[PipelineRowJson.Row], cfg: GenerateTextConfig, ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[PipelineRowJson.Row]] =
    rows.foldLeft(Future.successful(Vector.empty[PipelineRowJson.Row])) { (accF, row) =>
      accF.flatMap { acc =>
        val content = row.get(cfg.inputField) match {
          case None | Some(null) => fail("field-missing", s"field '${cfg.inputField}' is missing or null")
          case Some(s: String)   => s
          case Some(_)           => fail("field-not-string", s"field '${cfg.inputField}' is not a string")
        }
        val request = AiStepRequest(instruction = cfg.instruction, content = content, ownerUserId = ctx.ownerUserId)
        ctx.aiClient.complete(request).map {
          case Left(AiStepFailure.Unavailable(reason))  => fail("ai-unavailable", reason)
          case Left(AiStepFailure.Guardrail(reason))    => fail("ai-guardrail", reason)
          case Left(AiStepFailure.Api(status, body))    => fail("ai-error", s"API returned status $status: $body")
          case Left(AiStepFailure.Transport(message))   => fail("ai-error", message)
          case Left(AiStepFailure.QuotaExceeded(limit)) => fail("ai-quota-exceeded", AiQuotaMessage(limit))
          case Right(responseText) =>
            if (responseText.trim.isEmpty) fail("response-empty", "model response is empty or whitespace-only")
            acc :+ (row + (cfg.outputField -> responseText))
        }
      }
    }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    override def group: Option[StepGroup]     = Some(StepGroup.Ai)
    override def catalogDescription: String   = "Generate new text per row using an AI model, from an instruction and an input field."
    def decodeConfig(raw: String): Any    = GenerateTextConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[GenerateTextConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[GenerateTextConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[GenerateTextConfig].toJson

    /** design.md D2 -- shape errors (base `strictDecodeProblem`) plus the shared field
     *  validation. `decode` can itself throw on malformed (non-JSON / wrong-top-level-shape)
     *  input -- wrapped in `Try` (mirrors `AnalyzeWithAiStep.companion`'s identical guard) so
     *  that case degrades to `None` here rather than an uncaught exception. */
    override def validateRawConfig(raw: String): Option[String] =
      strictDecodeProblem(raw).orElse(scala.util.Try(GenerateTextConfig.validate(GenerateTextConfig.decode(raw))).getOrElse(None))

    /** design.md D2 -- `inputField`/`instruction`/`outputField` are required to run/analyze;
     *  reuses the same shared validator as the write path so the two surfaces cannot disagree.
     *  Same malformed-input `Try` guard as `validateRawConfig` above. */
    override def requiredConfigProblems(raw: String): Vector[String] =
      scala.util.Try(GenerateTextConfig.validate(GenerateTextConfig.decode(raw)).toVector).getOrElse(Vector.empty)
  }
}
