package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

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

/** Assert step — a pass-through op that persists assertion rules about the
 *  pipeline's output without evaluating them yet (HEL-454 / 419-A). `evaluate`
 *  returns the input rows UNCHANGED; rule evaluation and per-run pass/fail
 *  recording are 419-B's job. */
final case class AssertStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: AssertConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = AssertStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(rows)
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
}
