package com.helio.domain.steps

import com.helio.domain.{
  AssertionResult,
  PipelineExecutionContext,
  PipelineId,
  PipelineRowJson,
  PipelineStep,
  PipelineStepId
}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import java.util.regex.{Pattern, PatternSyntaxException}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Single assertion rule (HEL-454 / 419-A). `kind` is one of `notNull`,
 *  `unique`, `range`, `rowCountMin`, `rowCountMax`, `regex`. `field` is
 *  required for `notNull`/`unique`/`range`/`regex`; `rowCountMin`/
 *  `rowCountMax` are dataset-level and never check `field` (design.md
 *  Decision 4). `params` carries kind-specific parameters (`min`/`max` for
 *  `range`, `count` for `rowCountMin`/`rowCountMax`, `pattern` for `regex`) —
 *  no shape validation of `params` in this ticket (design.md Decision 6,
 *  419-B's job). `severity` is `warn` or `error`. */
final case class AssertRule(kind: String, field: Option[String], params: JsObject, severity: String)

object AssertRule {
  implicit val format: RootJsonFormat[AssertRule] = jsonFormat4(AssertRule.apply)
}

/** Typed config for the `assert` step: a vector of assertion rules. Wrapped
 *  in a one-field case class rather than a bare `Vector[AssertRule]` type
 *  alias (design.md Decision 1) so the wire shape stays a JSON object
 *  (`{"rules": [...]}`) like every sibling config, matching the
 *  JsObject-typed codec plumbing (`StepCodecUtil.asObject`,
 *  `PipelineStepConfigCodec.encodeJsObject`). */
final case class AssertConfig(rules: Vector[AssertRule])

object AssertConfig {
  implicit val format: RootJsonFormat[AssertConfig] = jsonFormat1(AssertConfig.apply)

  /** Tolerant decoder — never throws (design.md Decision 2, and a literal
   *  acceptance criterion). Missing `rules` defaults to an empty vector.
   *  Unlike `FilterCondition.decode`'s precedent (`Try(_.convertTo[T])
   *  .toOption`, which drops a malformed entry entirely), each rule entry
   *  here is decoded per-field-lenient: a missing/malformed `kind` defaults
   *  to `""`, `field` defaults to `None`, `params` defaults to
   *  `JsObject.empty`, and `severity` defaults to `"warn"` — the
   *  decode-tolerance default, deliberately different from the editor's
   *  new-rule default of `"error"` (design.md Decision 3). No rule is ever
   *  dropped, and a non-object array element degrades to an
   *  all-defaults rule rather than throwing. */
  def decode(raw: String): AssertConfig = {
    val obj   = StepCodecUtil.asObject(raw)
    val rules = obj.fields.get("rules") match {
      case Some(JsArray(items)) => items.map(decodeRule)
      case _                    => Vector.empty[AssertRule]
    }
    AssertConfig(rules)
  }

  private def decodeRule(item: JsValue): AssertRule = item match {
    case o: JsObject =>
      val kind = StepCodecUtil.stringOr(o, "kind", "")
      val field = o.fields.get("field") match {
        case Some(JsString(s)) => Some(s)
        case _                 => None
      }
      val params = o.fields.get("params") match {
        case Some(p: JsObject) => p
        case _                 => JsObject.empty
      }
      val severity = StepCodecUtil.stringOr(o, "severity", "warn")
      AssertRule(kind, field, params, severity)
    case _ =>
      AssertRule(kind = "", field = None, params = JsObject.empty, severity = "warn")
  }
}

/** Assert step — evaluates its rules against the rows at its position and
 *  records one [[AssertionResult]] per rule into `ctx.assertionSink`
 *  (HEL-509 / 419-B). `evaluate` still returns the input rows UNCHANGED —
 *  results are threaded out via the execution context, never smuggled into
 *  row data (design.md, `PipelineStep.evaluate`'s row-in/row-out contract). */
final case class AssertStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: AssertConfig,
    createdAt: Instant,
    updatedAt: Instant,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = AssertStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] = {
    val results = AssertStep.evaluateRules(rows, config.rules).map(_.copy(stepId = id.value))
    ctx.assertionSink.record(results)
    Future.successful(rows)
  }
}

object AssertStep {
  val Kind: String = "assert"

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = AssertConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[AssertConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[AssertConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[AssertConfig].toJson
  }

  private val SupportedKinds: Vector[String] = Vector(
    "notNull", "unique", "range", "rowCountMin", "rowCountMax", "regex"
  )
  private val SupportedSeverities: Vector[String] = Vector("warn", "error")

  /** Evaluate every rule against `rows`, producing one [[AssertionResult]]
   *  per rule (design.md Decision 2 — aggregated across the row set, never
   *  one per row). `stepId` is left empty here — the caller (`evaluate`)
   *  stamps the real step id, keeping this pure function callable
   *  independent of a live `AssertStep` instance for direct unit testing
   *  (design.md Decision 3). Never throws: a malformed rule (missing a
   *  required `params` key, or an unknown `kind`/`severity`) produces a
   *  failed result naming the malformed shape instead. */
  def evaluateRules(rows: Seq[PipelineRowJson.Row], rules: Vector[AssertRule]): Vector[AssertionResult] =
    rules.map(evaluateRule(rows, _))

  private def evaluateRule(rows: Seq[PipelineRowJson.Row], rule: AssertRule): AssertionResult =
    if (!SupportedSeverities.contains(rule.severity))
      malformed(rule, s"Invalid severity '${rule.severity}'. Valid values: ${SupportedSeverities.mkString(", ")}")
    else
      rule.kind match {
        case "notNull"     => evalNotNull(rows, rule)
        case "unique"      => evalUnique(rows, rule)
        case "range"       => evalRange(rows, rule)
        case "rowCountMin" => evalRowCount(rows, rule, isMin = true)
        case "rowCountMax" => evalRowCount(rows, rule, isMin = false)
        case "regex"       => evalRegex(rows, rule)
        case other =>
          malformed(rule, s"Unknown assertion kind: '$other'. Valid values: ${SupportedKinds.mkString(", ")}")
      }

  private def malformed(rule: AssertRule, message: String): AssertionResult =
    AssertionResult(
      stepId   = "",
      kind     = rule.kind,
      field    = rule.field,
      severity = rule.severity,
      passed   = false,
      observed = None,
      message  = Some(message)
    )

  private def requireField(rule: AssertRule)(f: String => AssertionResult): AssertionResult =
    rule.field match {
      case Some(field) if field.nonEmpty => f(field)
      case _                             => malformed(rule, s"Rule kind '${rule.kind}' requires 'field'")
    }

  /** `notNull(field)` — fails if any row's `field` is null or absent. A
   *  missing key and a present `null` value are treated identically. */
  private def evalNotNull(rows: Seq[PipelineRowJson.Row], rule: AssertRule): AssertionResult =
    requireField(rule) { field =>
      val nullCount = rows.count(row => row.getOrElse(field, null) == null)
      result(rule, Some(field), passed = nullCount == 0, observed = s"$nullCount row(s) with null '$field'",
        failureMessage = s"Field '$field' has $nullCount row(s) with a null value")
    }

  /** `unique(field)` — fails if any two rows share the same non-null `field`
   *  value. Null values are excluded from the duplicate check (mirrors
   *  PostgreSQL's own `UNIQUE` constraint semantics — NULL is never equal to
   *  another NULL for uniqueness purposes). */
  private def evalUnique(rows: Seq[PipelineRowJson.Row], rule: AssertRule): AssertionResult =
    requireField(rule) { field =>
      val nonNullValues  = rows.flatMap(row => Option(row.getOrElse(field, null)))
      val duplicateCount = nonNullValues.size - nonNullValues.distinct.size
      result(rule, Some(field), passed = duplicateCount == 0, observed = s"$duplicateCount duplicate value(s)",
        failureMessage = s"Field '$field' has $duplicateCount duplicate value(s)")
    }

  /** `range(field, params.min?, params.max?)` — fails if any row's numeric
   *  `field` value (coerced via `FilterStep`'s existing `v.toString.toDouble`
   *  pattern) falls outside the given bound(s); a value that doesn't coerce
   *  to a number is treated as a failure for this rule (can't prove it's in
   *  range). At least one of `min`/`max` is required. */
  private def evalRange(rows: Seq[PipelineRowJson.Row], rule: AssertRule): AssertionResult =
    requireField(rule) { field =>
      val minOpt = rule.params.fields.get("min").collect { case JsNumber(n) => n.toDouble }
      val maxOpt = rule.params.fields.get("max").collect { case JsNumber(n) => n.toDouble }
      if (minOpt.isEmpty && maxOpt.isEmpty)
        malformed(rule, s"Rule kind 'range' requires at least one of params.min/params.max")
      else {
        val failingCount = rows.count { row =>
          val v = row.getOrElse(field, null)
          if (v == null) true
          else
            Try(v.toString.toDouble).toOption match {
              case None      => true
              case Some(num) => minOpt.exists(num < _) || maxOpt.exists(num > _)
            }
        }
        result(rule, Some(field), passed = failingCount == 0, observed = s"$failingCount row(s) out of range",
          failureMessage = s"Field '$field' has $failingCount row(s) outside the allowed range")
      }
    }

  /** `rowCountMin(params.count)` / `rowCountMax(params.count)` — dataset-level,
   *  `field` never consulted (matches HEL-454 design.md Decision 4's
   *  field-requiring split). */
  private def evalRowCount(rows: Seq[PipelineRowJson.Row], rule: AssertRule, isMin: Boolean): AssertionResult =
    rule.params.fields.get("count").collect { case JsNumber(n) => n.toInt } match {
      case None =>
        malformed(rule, s"Rule kind '${rule.kind}' requires params.count")
      case Some(threshold) =>
        val actual = rows.size
        val passed = if (isMin) actual >= threshold else actual <= threshold
        val comparison = if (isMin) s"below minimum $threshold" else s"exceeds maximum $threshold"
        result(rule, None, passed, observed = s"$actual row(s)", failureMessage = s"Row count $actual $comparison")
    }

  /** `regex(field, params.pattern)` — fails if any row's `field` value
   *  doesn't match `pattern`. Mirrors `StringOpsStep.extractRegexFn`'s
   *  existing precedent exactly: `pattern` is compiled with
   *  `java.util.regex.Pattern` and matched via `find()` (partial match, not
   *  `matches()`); a null or absent `field` is guarded explicitly before
   *  calling `.toString` (`.toString` on a null `Any` throws
   *  `NullPointerException` in Scala) and treated as a rule failure — never
   *  an uncaught exception. */
  private def evalRegex(rows: Seq[PipelineRowJson.Row], rule: AssertRule): AssertionResult =
    requireField(rule) { field =>
      rule.params.fields.get("pattern") match {
        case Some(JsString(patternStr)) =>
          try {
            val compiled = Pattern.compile(patternStr)
            val failingCount = rows.count { row =>
              val v = row.getOrElse(field, null)
              val s = if (v == null) null else v.toString
              s == null || !compiled.matcher(s).find()
            }
            result(rule, Some(field), passed = failingCount == 0, observed = s"$failingCount row(s) not matching pattern",
              failureMessage = s"Field '$field' has $failingCount row(s) not matching pattern '$patternStr'")
          } catch {
            case e: PatternSyntaxException =>
              malformed(rule, s"Rule kind 'regex' has an invalid pattern '$patternStr': ${e.getMessage}")
          }
        case _ =>
          malformed(rule, "Rule kind 'regex' requires params.pattern")
      }
    }

  /** Shared pass/fail result builder — `message` is populated only on
   *  failure (design.md Decision 2). */
  private def result(
      rule: AssertRule,
      field: Option[String],
      passed: Boolean,
      observed: String,
      failureMessage: String
  ): AssertionResult =
    AssertionResult(
      stepId   = "",
      kind     = rule.kind,
      field    = field,
      severity = rule.severity,
      passed   = passed,
      observed = Some(observed),
      message  = if (passed) None else Some(failureMessage)
    )
}
