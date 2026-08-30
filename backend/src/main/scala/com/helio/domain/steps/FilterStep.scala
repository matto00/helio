package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
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
    // HEL-814 D4/5.1b: normalize a case-variant ("and" -> "AND") and pass an
    // UNKNOWN combinator through unchanged. Silently yielding "AND" for an
    // unrecognised value turns an OR filter into an AND filter — it changes
    // WHICH ROWS SURVIVE, the highest-severity finding in the enumeration.
    val combinator = StepCodecUtil.normalizeEnum(
      StepCodecUtil.str(obj, "combinator", "AND"),
      FilterStep.SupportedCombinators
    )
    val conditions = StepCodecUtil.typedArray[FilterCondition](
      obj, "conditions", "an array of {field, operator, value} objects"
    )
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
    updatedAt: Instant,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = FilterStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(FilterStep.apply(rows, config))
}

object FilterStep {
  val Kind: String = "filter"

  /** HEL-814 D4: the engine's own combinator set, used BOTH by the runtime
   *  match below and by the analyze/run validator — never a copy. */
  val SupportedCombinators: Vector[String] = Vector("AND", "OR")

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
        val numericMatch = for {
          f <- numericFieldValue(fieldVal)
          v <- value.flatMap(_.toDoubleOption)
        } yield f == v
        val isEqual = numericMatch.getOrElse {
          val fieldStr = if (fieldVal == null) null else fieldVal.toString
          val valStr   = value.getOrElse("")
          fieldStr == valStr
        }
        if (operator == "=") isEqual else !isEqual
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

  /** HEL-889: `=`/`!=` coerce numerically only when the row value's runtime type is itself
   *  numeric — a numeric-looking String (e.g. `player_id = "007"`) must keep exact string
   *  equality, so this is deliberately narrower than `PipelineRowJson.toDouble`'s String case
   *  (design D1/D5). */
  private def numericFieldValue(v: Any): Option[Double] = v match {
    case i: Int                    => Some(i.toDouble)
    case l: Long                   => Some(l.toDouble)
    case f: Float                  => Some(f.toDouble)
    case d: Double                 => Some(d)
    case bd: BigDecimal            => Some(bd.toDouble)
    case jbd: java.math.BigDecimal => Some(jbd.doubleValue)
    case _                         => None
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = FilterConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[FilterConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[FilterConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[FilterConfig].toJson

    /** HEL-814 D4. `conditions` stays optional — `pipeline-filter-op:11`
     *  guarantees an empty array passes all rows. An unknown `combinator` is
     *  rejected: silently yielding `AND` turns an OR filter into an AND
     *  filter, changing WHICH ROWS SURVIVE. */
    override def requiredConfigProblems(raw: String): Vector[String] =
      StepCodecUtil.unsupportedEnum(Kind, "combinator", FilterConfig.decode(raw).combinator, SupportedCombinators)
  }
}
