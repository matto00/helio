package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `pivot` step (HEL-375). `index` names the source
 *  columns to group by (a `null` value at an index field is a valid group
 *  key, mirroring `aggregate`'s `groupBy` semantics); `column` names the
 *  source column whose distinct values become new output columns; `values`
 *  names the source column whose values are aggregated into each new output
 *  column; `agg` selects the aggregation function (`sum`/`count`/`avg`/
 *  `min`/`max`/`first`). */
final case class PivotConfig(index: Vector[String], column: String, values: String, agg: String)

object PivotConfig {
  implicit val format: RootJsonFormat[PivotConfig] = jsonFormat4(PivotConfig.apply)

  def decode(raw: String): PivotConfig = {
    val obj   = StepCodecUtil.asObject(raw)
    val index = obj.fields.get("index") match {
      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
      case _                    => Vector.empty[String]
    }
    val column = StepCodecUtil.stringOr(obj, "column", "")
    val values = StepCodecUtil.stringOr(obj, "values", "")
    val agg    = StepCodecUtil.stringOr(obj, "agg", "")
    PivotConfig(index, column, values, agg)
  }
}

/** Pivot step — reshapes long rows into wide rows: groups by `index`, and
 *  for each distinct value `v` of `column` within a group, emits an output
 *  column named `<values>_<v>` whose value is `agg` applied to `values`
 *  across that group+value's rows (design.md decision 1 — the `<values>_<v>`
 *  naming self-documents which metric field the pivoted column holds and
 *  lowers collision odds with `index` field names).
 *
 *  Rows whose `column` value is `null` are excluded from value-column
 *  computation but do not prevent their `index` group from producing an
 *  output row (design.md decision 3 — mirrors `AggregateStep`'s "empty
 *  groupBy collapses to one row" precedent of never dropping a would-be
 *  output row for data reasons alone).
 *
 *  Supported `agg` functions: `sum`/`avg`/`min`/`max` reuse `AggregateStep`'s
 *  numeric-coercion behavior (nulls/non-numeric ignored); `count` counts
 *  non-null `values` cells in the group+value bucket; `first` (new, absent
 *  from `AggregateStep`) returns the raw (un-coerced) `values` cell of the
 *  first row encountered in input row order (design.md decision 4). An
 *  unsupported `agg` throws `IllegalArgumentException`, mirroring
 *  `AggregateStep.apply`'s `case other => throw ...` arm. */
final case class PivotStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: PivotConfig,
    createdAt: Instant,
    updatedAt: Instant,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = PivotStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(PivotStep.apply(rows, config))
}

object PivotStep {
  val Kind: String = "pivot"

  private val SupportedAggs = Vector("sum", "count", "avg", "min", "max", "first")

  def apply(rows: Seq[PipelineRowJson.Row], cfg: PivotConfig): Seq[PipelineRowJson.Row] = {
    if (!SupportedAggs.contains(cfg.agg))
      throw new IllegalArgumentException(
        s"Unsupported pivot aggregation function: '${cfg.agg}'. Supported: ${SupportedAggs.mkString(", ")}"
      )

    val indexFields = cfg.index
    val column      = cfg.column
    val values      = cfg.values

    // Stage 1: group all rows by the index tuple — this determines which
    // output rows exist at all (design.md decision 3), including a `null`
    // index value being a valid group key (mirrors AggregateStep.groupBy).
    val grouped: Map[Seq[Any], Seq[PipelineRowJson.Row]] =
      rows.groupBy(row => indexFields.map(name => row.getOrElse(name, null)))

    grouped.map { case (keyValues, groupRows) =>
      val indexMap: PipelineRowJson.Row = indexFields.zip(keyValues).toMap

      // Stage 2: within the group, further group by non-null `column` values
      // to compute one agg(values) per distinct value. Rows with a null
      // `column` value are excluded from this stage but the group's output
      // row still emits via indexMap above.
      val byPivotValue: Map[Any, Seq[PipelineRowJson.Row]] =
        groupRows.filter(_.getOrElse(column, null) != null).groupBy(_.getOrElse(column, null))

      val valueColumnsMap: PipelineRowJson.Row = byPivotValue.map { case (pivotValue, valueRows) =>
        val colName = s"${values}_$pivotValue"
        val value: Any = cfg.agg match {
          case "sum" =>
            valueRows.flatMap(r => PipelineRowJson.toDouble(r.getOrElse(values, null))).sum
          case "avg" =>
            val nums = valueRows.flatMap(r => PipelineRowJson.toDouble(r.getOrElse(values, null)))
            if (nums.isEmpty) null else nums.sum / nums.size
          case "min" =>
            val nums = valueRows.flatMap(r => PipelineRowJson.toDouble(r.getOrElse(values, null)))
            if (nums.isEmpty) null else nums.min
          case "max" =>
            val nums = valueRows.flatMap(r => PipelineRowJson.toDouble(r.getOrElse(values, null)))
            if (nums.isEmpty) null else nums.max
          case "count" =>
            valueRows.count(r => r.getOrElse(values, null) != null).toLong
          case "first" =>
            valueRows.head.getOrElse(values, null)
        }
        colName -> value
      }.toMap

      // design.md decision 2: later-computed value columns win on collision
      // with index fields or each other (indexMap ++ valueColumnsMap).
      indexMap ++ valueColumnsMap
    }.toSeq
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = PivotConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[PivotConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[PivotConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[PivotConfig].toJson
  }
}
