package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** A field name + declared type pair used in [[AggregateConfig.groupBy]].
 *  The type hint is informational — the engine groups by the raw value. */
final case class AggregateField(name: String, `type`: String)

object AggregateField {
  implicit val format: RootJsonFormat[AggregateField] = jsonFormat2(AggregateField.apply)
}

/** A single aggregation request: `<fn>(<field>) AS <alias>`. */
final case class Aggregation(alias: String, fn: String, field: String)

object Aggregation {
  implicit val format: RootJsonFormat[Aggregation] = jsonFormat3(Aggregation.apply)
}

/** Typed config for the `aggregate` step. Multi-aggregation variant of
 *  [[GroupByConfig]] — emits one row per group with one column per
 *  aggregation alias. */
final case class AggregateConfig(groupBy: Vector[AggregateField], aggregations: Vector[Aggregation])

object AggregateConfig {
  implicit val format: RootJsonFormat[AggregateConfig] = jsonFormat2(AggregateConfig.apply)

  def decode(raw: String): AggregateConfig = {
    val obj          = StepCodecUtil.asObject(raw)
    val groupBy      = obj.fields.get("groupBy") match {
      case Some(JsArray(items)) =>
        items.flatMap(it => Try(it.convertTo[AggregateField]).toOption)
      case _ => Vector.empty[AggregateField]
    }
    val aggregations = obj.fields.get("aggregations") match {
      case Some(JsArray(items)) =>
        items.flatMap(it => Try(it.convertTo[Aggregation]).toOption)
      case _ => Vector.empty[Aggregation]
    }
    AggregateConfig(groupBy, aggregations)
  }
}

/** Aggregate step — groups by the `groupBy` fields and emits one row per
 *  group with one column per aggregation alias. Supported functions: `sum`,
 *  `avg`, `min`, `max`, `count`. Anything else fails at execute time with a
 *  descriptive error. Empty `groupBy` collapses all rows into a single
 *  group. */
final case class AggregateStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: AggregateConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = AggregateStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(AggregateStep.apply(rows, config))
}

object AggregateStep {
  val Kind: String = "aggregate"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: AggregateConfig): Seq[PipelineRowJson.Row] = {
    val groupByFields = cfg.groupBy.map(_.name)
    val aggregations  = cfg.aggregations

    val grouped: Map[Seq[Any], Seq[PipelineRowJson.Row]] =
      rows.groupBy(row => groupByFields.map(name => row.getOrElse(name, null)))

    grouped.map { case (keyValues, groupRows) =>
      val keyMap: PipelineRowJson.Row = groupByFields.zip(keyValues).toMap
      val aggMap: PipelineRowJson.Row = aggregations.map { agg =>
        val alias = agg.alias
        val fn    = agg.fn.toLowerCase
        val field = agg.field
        val nums  = groupRows.flatMap(r => PipelineRowJson.toDouble(r.getOrElse(field, null)))
        val value: Any = fn match {
          case "sum"   => nums.sum
          case "avg"   => if (nums.isEmpty) null else nums.sum / nums.size
          case "min"   => if (nums.isEmpty) null else nums.min
          case "max"   => if (nums.isEmpty) null else nums.max
          case "count" => groupRows.count(r => r.getOrElse(field, null) != null).toLong
          case other =>
            throw new IllegalArgumentException(
              "Unsupported aggregation function: " + other +
                ". Supported: sum, avg, min, max, count"
            )
        }
        alias -> value
      }.toMap
      keyMap ++ aggMap
    }.toSeq
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = AggregateConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[AggregateConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[AggregateConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[AggregateConfig].toJson
  }
}
