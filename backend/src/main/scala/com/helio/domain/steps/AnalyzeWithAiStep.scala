package com.helio.domain.steps

import com.helio.domain.ai.{AiQuotaMessage, AiStepFailure, AiStepRequest}
import com.helio.domain.engine.PipelineRowJson
import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId, StepGroup}
import com.fasterxml.jackson.core.{JsonParser => JacksonJsonParser}
import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import com.fasterxml.jackson.databind.node.ObjectNode
import spray.json._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1106 (design.md section 6) -- the first AI pipeline step: for every input row, sends
 *  `cfg.instruction` plus the row's `cfg.inputField` content to the model (through
 *  `ctx.aiClient`, never `ClaudeClient` directly -- design.md D2), then strictly enforces the
 *  model's response against `cfg.outputSchema` before appending any column. Runs ONE call per
 *  row, SEQUENTIALLY (design.md D5 -- bounded cost, deterministic order; batching is a documented
 *  follow-up). The whole run fails on the first bad row -- output columns are added only after
 *  the FULL response validates, so a partially-enforced row is unreachable by construction
 *  (design.md D6 / tasks.md C5). */
final case class AnalyzeWithAiStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: AnalyzeWithAiConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = AnalyzeWithAiStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    AnalyzeWithAiStep.apply(rows, config, ctx)
}

object AnalyzeWithAiStep {
  val Kind: String = "analyzewithai"

  /** design.md D6 -- every named failure reason, prefixed onto the `IllegalArgumentException`
   *  message so `StepExecutionException.from`'s allowlist (an `IllegalArgumentException`'s
   *  `getMessage` is kept verbatim) surfaces it to the run's error unmodified, mirroring
   *  `ConvertFormatStep.fail`. */
  private def fail(code: String, detail: String): Nothing =
    throw new IllegalArgumentException(s"analyzewithai $code: $detail")

  /** Sequential per-row evaluation (design.md D5): rows are folded left-to-right through the
   *  model call so a failure on row N never issues a call for row N+1, and the whole run fails
   *  on the first bad row (deterministic, bounded cost). */
  def apply(rows: Seq[PipelineRowJson.Row], cfg: AnalyzeWithAiConfig, ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[PipelineRowJson.Row]] =
    rows.foldLeft(Future.successful(Vector.empty[PipelineRowJson.Row])) { (accF, row) =>
      accF.flatMap { acc =>
        val content = row.get(cfg.inputField) match {
          case None | Some(null) => fail("field-missing", s"field '${cfg.inputField}' is missing or null")
          case Some(s: String)   => s
          case Some(_)           => fail("field-not-string", s"field '${cfg.inputField}' is not a string")
        }
        val request = AiStepRequest(instruction = prompt(cfg), content = content, ownerUserId = ctx.ownerUserId)
        ctx.aiClient.complete(request).map {
          case Left(AiStepFailure.Unavailable(reason))   => fail("ai-unavailable", reason)
          case Left(AiStepFailure.Guardrail(reason))     => fail("ai-guardrail", reason)
          case Left(AiStepFailure.Api(status, body))     => fail("ai-error", s"API returned status $status: $body")
          case Left(AiStepFailure.Transport(message))    => fail("ai-error", message)
          case Left(AiStepFailure.QuotaExceeded(limit))  => fail("ai-quota-exceeded", AiQuotaMessage(limit))
          case Right(responseText) =>
            val values = enforce(responseText, cfg)
            acc :+ (row ++ values)
        }
      }
    }

  /** design.md D5 -- states the instruction, the exact output keys and types, and asks for a
   *  bare JSON object (no markdown fence, though one surrounding fence is tolerated on parse). */
  private def prompt(cfg: AnalyzeWithAiConfig): String = {
    val fields = cfg.outputSchema.map(f => s"\"${f.name}\" (${f.`type`})").mkString(", ")
    s"${cfg.instruction}\n\n" +
      s"Respond with only a single JSON object with exactly these keys and types: $fields. " +
      "No markdown code fence, no explanation, no text before or after the JSON object."
  }

  /** Strips at most ONE surrounding markdown code fence (design.md D5's documented tolerance) --
   *  anything else (nested fences, a fence that doesn't wrap the whole trimmed text) is left
   *  alone and falls to the strict parser below, which then reports `response-malformed-json`. */
  private def stripFence(text: String): String = {
    val trimmed = text.trim
    val fenceStart = """(?s)^```(?:json)?\s*\n(.*)\n```$""".r
    trimmed match {
      case fenceStart(inner) => inner.trim
      case _                 => trimmed
    }
  }

  private val jsonMapper: ObjectMapper = new ObjectMapper()

  /** design.md D6 -- parses with Jackson, requiring end-of-input after the tree (HEL-1105
   *  lesson: `ObjectMapper.readTree(String)` silently ignores trailing content), then checks the
   *  declared schema is EXACTLY matched: no missing key, no extra key, and each present value's
   *  JSON type matches the declared type. Output columns are only ever built from the fully
   *  validated map -- there is no code path that returns a partial map. */
  private def enforce(responseText: String, cfg: AnalyzeWithAiConfig): Map[String, Any] = {
    val stripped = stripFence(responseText)
    val node: JsonNode = {
      var parser: JacksonJsonParser = null
      try {
        parser = jsonMapper.createParser(stripped)
        val n: JsonNode = jsonMapper.readTree(parser)
        if (n == null || parser.nextToken() != null)
          fail("response-malformed-json", "response is not a single valid JSON value, or has trailing content")
        n
      } catch {
        case _: Exception => fail("response-malformed-json", "response is not valid JSON")
      } finally {
        if (parser != null) parser.close()
      }
    }
    if (!node.isObject) fail("response-not-object", "response is not a JSON object")
    val obj          = node.asInstanceOf[ObjectNode]
    val declaredKeys = cfg.outputSchema.map(_.name).toSet
    // A structurally-present key (`obj.fieldNames()`) whose value is JSON `null` counts as
    // MISSING, not present (design.md D6: "JSON `null` counts as missing, since spray/Jackson
    // null vs absent are not distinguished downstream") -- `nonNullKeys` is what "declared and
    // actually usable" means; `actualKeys` (structural presence, null or not) is still what
    // "extra key" means, since a stray null-valued undeclared key is still undeclared.
    val actualKeys  = obj.fieldNames().asScala.toSet
    val nonNullKeys = actualKeys.filterNot(k => obj.get(k).isNull)

    val missing = declaredKeys.diff(nonNullKeys)
    if (missing.nonEmpty) fail("response-missing-field", s"response is missing declared key(s): ${missing.toSeq.sorted.mkString(", ")}")

    val extra = actualKeys.diff(declaredKeys)
    if (extra.nonEmpty) fail("response-extra-field", s"response has undeclared key(s): ${extra.toSeq.sorted.mkString(", ")}")

    cfg.outputSchema.map { field =>
      val v = obj.get(field.name)
      field.`type` match {
        case "string" =>
          if (v.isTextual) field.name -> v.asText()
          else fail("response-wrong-type", s"'${field.name}' must be a JSON string, got ${kindName(v)}")
        case "integer" =>
          if (v.isIntegralNumber && v.canConvertToLong) field.name -> v.asLong()
          else fail("response-wrong-type", s"'${field.name}' must be a whole number that fits in a Long, got ${kindName(v)}")
        case "float" =>
          if (v.isNumber) field.name -> v.asDouble()
          else fail("response-wrong-type", s"'${field.name}' must be a JSON number, got ${kindName(v)}")
        case "boolean" =>
          if (v.isBoolean) field.name -> v.asBoolean()
          else fail("response-wrong-type", s"'${field.name}' must be a JSON boolean, got ${kindName(v)}")
        case other =>
          // Defense-in-depth only -- write-path validation (AnalyzeWithAiConfig.validate)
          // already rejects every type outside AllowedOutputTypes before a step can be saved
          // with one. Reachable only for a row persisted before that validation existed.
          fail("response-wrong-type", s"'${field.name}' declares unsupported type '$other'")
      }
    }.toMap
  }

  private def kindName(v: JsonNode): String =
    if (v == null || v.isMissingNode) "a missing value"
    else if (v.isNull) "null"
    else if (v.isTextual) "a string"
    else if (v.isArray) "an array"
    else if (v.isObject) "an object"
    else if (v.isBoolean) "a boolean"
    else if (v.isNumber) "a number"
    else "an unexpected shape"

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    override def group: Option[StepGroup]     = Some(StepGroup.Ai)
    override def catalogDescription: String   = "Extract structured fields from each row's text using an AI model."
    def decodeConfig(raw: String): Any    = AnalyzeWithAiConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[AnalyzeWithAiConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[AnalyzeWithAiConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[AnalyzeWithAiConfig].toJson

    /** design.md D1 -- shape errors (base `strictDecodeProblem`) plus the shared field/type
     *  validation. `decode` can itself throw on malformed (non-JSON / wrong-top-level-shape)
     *  input -- wrapped in `Try` (mirrors `ConvertFormatConfig.pairError`'s identical guard) so
     *  that case degrades to `None` here (the pre-existing "invalid config" category the calling
     *  surfaces already report from their own decode `Try`) rather than an uncaught exception. */
    override def validateRawConfig(raw: String): Option[String] =
      strictDecodeProblem(raw).orElse(scala.util.Try(AnalyzeWithAiConfig.validate(AnalyzeWithAiConfig.decode(raw))).getOrElse(None))

    /** design.md D1 -- `inputField`/`instruction`/`outputSchema` are required to run/analyze;
     *  reuses the same shared validator as the write path so the two surfaces cannot disagree.
     *  Same malformed-input `Try` guard as `validateRawConfig` above. */
    override def requiredConfigProblems(raw: String): Vector[String] =
      scala.util.Try(AnalyzeWithAiConfig.validate(AnalyzeWithAiConfig.decode(raw)).toVector).getOrElse(Vector.empty)
  }
}
