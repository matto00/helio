package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Single filter clause. Operator is one of `=` `!=` `>` `>=` `<` `<=`
 *  `contains` `is null` `is not null`. `value` is omitted for the null
 *  operators. */
final case class FilterCondition(field: String, operator: String, value: Option[String])

object FilterCondition {
  implicit val format: RootJsonFormat[FilterCondition] = jsonFormat3(FilterCondition.apply)
}

/** Typed config for the `filter` step. `combinator` is `AND` or `OR` and is
 *  applied across all `conditions`. */
final case class FilterConfig(combinator: String, conditions: Vector[FilterCondition])

object FilterConfig {
  implicit val format: RootJsonFormat[FilterConfig] = jsonFormat2(FilterConfig.apply)

  /** Tolerant decoder: legacy rows may have persisted partial configs
   *  mid-edit. Missing `combinator` defaults to `AND`; missing `conditions`
   *  defaults to empty. */
  def decode(raw: String): FilterConfig = {
    val obj        = StepCodecUtil.asObject(raw)
    val combinator = StepCodecUtil.stringOr(obj, "combinator", "AND")
    val conditions = obj.fields.get("conditions") match {
      case Some(JsArray(items)) =>
        items.flatMap(it => Try(it.convertTo[FilterCondition]).toOption)
      case _ => Vector.empty[FilterCondition]
    }
    FilterConfig(combinator, conditions)
  }
}

/** Filter step — applies AND/OR combinator over typed conditions. Numeric
 *  comparisons that fail to coerce both sides return false (the row is
 *  excluded). */
final case class FilterStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: FilterConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = FilterStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(FilterStep.apply(rows, config))
}

object FilterStep {
  val Kind: String = "filter"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: FilterConfig): Seq[PipelineRowJson.Row] = {
    val conditions = cfg.conditions
    if (conditions.isEmpty) return rows
    val combinator = cfg.combinator

    rows.filter { row =>
      val results = conditions.flatMap { cond =>
        val field = cond.field
        if (field.isEmpty) None
        else {
          val operator = cond.operator
          val value    = cond.value
          val fieldVal = row.getOrElse(field, null)
          Some(evalCondition(fieldVal, operator, value))
        }
      }
      if (results.isEmpty) true
      else combinator.toUpperCase match {
        case "OR" => results.exists(identity)
        case _    => results.forall(identity)
      }
    }
  }

  private def evalCondition(fieldVal: Any, operator: String, value: Option[String]): Boolean =
    operator match {
      case "is null"     => fieldVal == null
      case "is not null" => fieldVal != null
      case "contains"    => fieldVal != null && fieldVal.toString.contains(value.getOrElse(""))
      case "=" | "!=" =>
        val fieldStr = if (fieldVal == null) null else fieldVal.toString
        val valStr   = value.getOrElse("")
        if (operator == "=") fieldStr == valStr else fieldStr != valStr
      case ">" | ">=" | "<" | "<=" =>
        val fieldNum = Option(fieldVal).flatMap(v => Try(v.toString.toDouble).toOption)
        val valNum   = Try(value.getOrElse("").toDouble).toOption
        (fieldNum, valNum) match {
          case (Some(f), Some(v)) =>
            operator match {
              case ">"  => f > v
              case ">=" => f >= v
              case "<"  => f < v
              case "<=" => f <= v
              case _    => false
            }
          case _ => false
        }
      case _ => false
    }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = FilterConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[FilterConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[FilterConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[FilterConfig].toJson
  }
}
