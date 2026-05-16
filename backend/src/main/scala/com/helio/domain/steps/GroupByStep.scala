package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `groupby` step. Single aggregation column +
 *  function shape — superseded by [[AggregateConfig]] for multi-aggregation
 *  pipelines, but retained for backward compatibility with the existing
 *  step kind. */
final case class GroupByConfig(groupBy: Vector[String], aggColumn: String, aggFunction: String)

object GroupByConfig {
  implicit val format: RootJsonFormat[GroupByConfig] = jsonFormat3(GroupByConfig.apply)

  def decode(raw: String): GroupByConfig = {
    val obj     = StepCodecUtil.asObject(raw)
    val groupBy = obj.fields.get("groupBy") match {
      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
      case _                    => Vector.empty[String]
    }
    val aggColumn   = StepCodecUtil.stringOr(obj, "aggColumn", "")
    val aggFunction = StepCodecUtil.stringOr(obj, "aggFunction", "sum")
    GroupByConfig(groupBy, aggColumn, aggFunction)
  }
}

/** GroupBy step — groups rows by `groupBy` columns and emits one row per
 *  group with a single aggregate column named `<aggFunction>_<aggColumn>`.
 *  Supported functions: `sum`, `count` (anything else fails at execute time
 *  with a descriptive error). */
final case class GroupByStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: GroupByConfig,
    createdAt: Instant,
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = GroupByStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(GroupByStep.apply(rows, config))
}

object GroupByStep {
  val Kind: String = "groupby"

  def apply(rows: Seq[PipelineRowJson.Row], cfg: GroupByConfig): Seq[PipelineRowJson.Row] = {
    val groupCols = cfg.groupBy
    val aggCol    = cfg.aggColumn
    val aggFn     = cfg.aggFunction.toLowerCase
    val outputCol = aggFn + "_" + aggCol
    val grouped   = rows.groupBy(row => groupCols.map(c => row.getOrElse(c, null)))
    grouped.map { case (keyValues, groupRows) =>
      val keyMap: PipelineRowJson.Row = groupCols.zip(keyValues).toMap
      val aggValue: Any = aggFn match {
        case "sum" =>
          val nums = groupRows.flatMap(r => PipelineRowJson.toDouble(r.getOrElse(aggCol, null)))
          nums.sum
        case "count" =>
          groupRows.count(r => r.getOrElse(aggCol, null) != null).toLong
        case other =>
          throw new IllegalArgumentException(
            "Unsupported aggregation function: " + other + ". Supported: sum, count"
          )
      }
      keyMap + (outputCol -> aggValue)
    }.toSeq
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = GroupByConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[GroupByConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[GroupByConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[GroupByConfig].toJson
  }
}
