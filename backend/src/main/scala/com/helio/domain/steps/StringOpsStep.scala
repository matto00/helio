package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import java.util.regex.{Pattern, PatternSyntaxException}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Typed config for the `stringops` step (HEL-389) — the seventh leaf of the
 *  HEL-336 Pipeline Op Expansion epic. `operation` selects one of six
 *  per-value string transforms (`trim`/`upper`/`lower`/`split`/`extractRegex`/
 *  `concat`); `field` is the source column for the five single-field
 *  operations (unused by `concat`, which reads `fields` instead).
 *  `outputColumn` is the required destination column — writing there
 *  overwrites `field` in place when the two names are equal, otherwise it
 *  appends a distinct column (design.md decision 2). `pattern` is required by
 *  `extractRegex`; `separator`/`index` are required by `split` (`separator`
 *  is also used, optionally, by `concat`'s join); `fields` is used by
 *  `concat`. */
final case class StringOpsConfig(
    operation: String,
    field: String,
    outputColumn: String,
    pattern: Option[String],
    separator: Option[String],
    index: Option[Int],
    fields: Option[Vector[String]]
)

object StringOpsConfig {
  implicit val format: RootJsonFormat[StringOpsConfig] = jsonFormat7(StringOpsConfig.apply)

  def decode(raw: String): StringOpsConfig = {
    val obj          = StepCodecUtil.asObject(raw)
    val operation     = StepCodecUtil.stringOr(obj, "operation", "")
    val field         = StepCodecUtil.stringOr(obj, "field", "")
    val outputColumn  = StepCodecUtil.stringOr(obj, "outputColumn", "")
    val pattern       = obj.fields.get("pattern").collect { case JsString(s) => s }
    val separator     = obj.fields.get("separator").collect { case JsString(s) => s }
    val index = obj.fields.get("index") match {
      case Some(JsNumber(n)) => Try(n.toIntExact).toOption
      case _                 => None
    }
    val fields = obj.fields.get("fields") match {
      case Some(JsArray(items)) => Some(items.collect { case JsString(s) => s })
      case _                    => None
    }
    StringOpsConfig(operation, field, outputColumn, pattern, separator, index, fields)
  }
}

/** StringOps step — a per-value column transform that writes a derived
 *  string to `outputColumn`. Unlike `SplitTextStep` (which explodes a
 *  `string-body` field into multiple rows), `stringops` never changes row
 *  count — it is closest in shape to `ComputeStep` (derived column) crossed
 *  with `CastStep` (per-field transform, schema-preserving when the target
 *  overwrites the source).
 *
 *  Per-row null handling (design.md decisions 3-6): for the five single-field
 *  operations (`trim`/`upper`/`lower`/`split`/`extractRegex`), a null/absent
 *  `field` value yields `null` in `outputColumn` before any per-op logic
 *  runs. `concat` deviates deliberately — a null/missing field in `fields`
 *  contributes an empty string, not a whole-output `null`, since `concat`'s
 *  purpose is to always produce a joined string even over sparse columns.
 *  `split`'s out-of-bounds `index` and `extractRegex`'s non-match both yield
 *  `null` for that row (data conditions, not config errors). An unsupported
 *  `operation`, a `split` missing `separator`/`index`, or an `extractRegex`
 *  `pattern` without a capturing group are step-level misconfigurations that
 *  fail at execute time before any row is processed. */
final case class StringOpsStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: StringOpsConfig,
    createdAt: Instant,
    updatedAt: Instant,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = StringOpsStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(StringOpsStep.apply(rows, config))
}

object StringOpsStep {
  val Kind: String = "stringops"

  private val SupportedOperations = Vector("trim", "upper", "lower", "split", "extractRegex", "concat")

  def apply(rows: Seq[PipelineRowJson.Row], cfg: StringOpsConfig): Seq[PipelineRowJson.Row] = {
    if (!SupportedOperations.contains(cfg.operation))
      throw new IllegalArgumentException(
        s"Unsupported stringops operation: '${cfg.operation}'. Supported: ${SupportedOperations.mkString(", ")}"
      )

    val valueFn: PipelineRowJson.Row => Any = cfg.operation match {
      case "trim"  => singleFieldFn(cfg.field, s => s.trim)
      case "upper" => singleFieldFn(cfg.field, s => s.toUpperCase)
      case "lower" => singleFieldFn(cfg.field, s => s.toLowerCase)
      case "split" =>
        val separator = cfg.separator.getOrElse(
          throw new IllegalArgumentException("stringops operation 'split' requires 'separator'")
        )
        val index = cfg.index.getOrElse(
          throw new IllegalArgumentException("stringops operation 'split' requires 'index'")
        )
        splitFn(cfg.field, separator, index)
      case "extractRegex" =>
        val patternStr = cfg.pattern.getOrElse(
          throw new IllegalArgumentException("stringops operation 'extractRegex' requires 'pattern'")
        )
        extractRegexFn(cfg.field, patternStr)
      case "concat" =>
        concatFn(cfg.fields.getOrElse(Vector.empty), cfg.separator.getOrElse(""))
    }

    rows.map(row => row + (cfg.outputColumn -> valueFn(row)))
  }

  /** Shared null-on-missing wrapper for the four single-field operations that
   *  don't need per-row failure handling beyond null propagation (design.md
   *  decision 3): a null/absent `field` value yields `null`, otherwise `fn`
   *  transforms the stringified value. */
  private def singleFieldFn(field: String, fn: String => String): PipelineRowJson.Row => Any =
    row => {
      val v = row.getOrElse(field, null)
      if (v == null) null else fn(v.toString)
    }

  /** `split`: literal (non-regex) separator split, indexed by `index`.
   *  Out-of-bounds `index` (including negative) yields `null` for that row
   *  (design.md decision 5). `Pattern.quote` is used so the separator is
   *  treated as a literal string even when it contains regex metacharacters
   *  (`String#split` takes a regex). */
  private def splitFn(field: String, separator: String, index: Int): PipelineRowJson.Row => Any =
    row => {
      val v = row.getOrElse(field, null)
      if (v == null) null
      else {
        val parts = v.toString.split(Pattern.quote(separator), -1)
        if (index >= 0 && index < parts.length) parts(index) else null
      }
    }

  /** `extractRegex`: `pattern` MUST contain at least one capturing group —
   *  validated once up front (step-level misconfiguration, design.md decision
   *  6), not per row. Per row: null/absent `field` or a non-match yields
   *  `null`; a match extracts the first capturing group. */
  private def extractRegexFn(field: String, patternStr: String): PipelineRowJson.Row => Any = {
    val compiled =
      try Pattern.compile(patternStr)
      catch {
        case e: PatternSyntaxException =>
          throw new IllegalArgumentException(s"stringops operation 'extractRegex' has an invalid pattern '$patternStr': ${e.getMessage}")
      }
    if (compiled.matcher("").groupCount() < 1)
      throw new IllegalArgumentException(
        s"stringops operation 'extractRegex' pattern '$patternStr' requires at least one capturing group"
      )

    row => {
      val v = row.getOrElse(field, null)
      if (v == null) null
      else {
        val matcher = compiled.matcher(v.toString)
        if (matcher.find()) matcher.group(1) else null
      }
    }
  }

  /** `concat`: joins `fields`' values with `separator`; a null/missing field
   *  contributes an empty string, not a whole-output `null` (design.md
   *  decision 4 — a deliberate deviation from the other five operations' null
   *  propagation, scoped to `concat` because it spans multiple fields rather
   *  than transforming one value). An empty/absent `fields` list yields `""`
   *  for every row — a valid, if degenerate, configuration. */
  private def concatFn(fields: Vector[String], separator: String): PipelineRowJson.Row => Any =
    row =>
      fields
        .map { f =>
          val v = row.getOrElse(f, null)
          if (v == null) "" else v.toString
        }
        .mkString(separator)

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = StringOpsConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[StringOpsConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[StringOpsConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[StringOpsConfig].toJson
  }
}
