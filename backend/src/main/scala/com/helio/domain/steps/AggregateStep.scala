package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
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
    val groupBy      = StepCodecUtil.typedArray[AggregateField](obj, "groupBy", "an array of {name, type} objects")
    val aggregations = StepCodecUtil.typedArray[Aggregation](obj, "aggregations", "an array of {alias, fn, field} objects")
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
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = AggregateStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(AggregateStep.apply(rows, config))
}

object AggregateStep {
  val Kind: String = "aggregate"

  // HEL-859 (design.md Decisions 5/3.4a): single source of truth driving both
  // the runtime `match` below and the analyze-time validator — no longer a
  // hardcoded duplicate inside the error message.
  val SupportedFunctions: Vector[String] = Vector("sum", "avg", "min", "max", "count")

  def apply(rows: Seq[PipelineRowJson.Row], cfg: AggregateConfig): Seq[PipelineRowJson.Row] = {
    val groupByFields = cfg.groupBy.map(_.name)
    val aggregations  = cfg.aggregations

    // HEL-905 (design.md Decision 10, HEL-744): an empty groupBy over zero input rows must
    // still yield ONE row -- `count = 0L`, every other requested fn `null` -- so a metric Output
    // off an empty filter shows 0 rather than silently disappearing. Scoped to exactly this one
    // new branch; a non-empty groupBy over zero rows still falls through to the unchanged
    // `rows.groupBy(...)` logic below, which already yields zero output rows for that case (the
    // anti-over-fix guard -- no code change needed for that arm).
    //
    // Note the deliberate asymmetry with a REAL (non-empty) group's all-null-field behavior
    // below: THIS branch's `sum` is `null` (there is no group at all -- summing "nothing" has no
    // numeric identity meaningful to a caller), whereas a genuine group whose numeric field is
    // present-but-always-null sums to `0.0` (`Seq.empty.sum == 0.0`, a real computed value over a
    // real, non-empty row set). Both are AC-specified; this is not an inconsistency to "fix".
    if (rows.isEmpty && groupByFields.isEmpty) {
      val aggMap: PipelineRowJson.Row = aggregations.map { agg =>
        val fn = agg.fn.toLowerCase
        if (!SupportedFunctions.contains(fn))
          throw new IllegalArgumentException(
            "Unsupported aggregation function: " + fn +
              ". Supported: " + SupportedFunctions.mkString(", ")
          )
        val value: Any = fn match {
          case "count" => 0L
          case _       => null
        }
        agg.alias -> value
      }.toMap
      Seq(aggMap)
    } else {
      val grouped: Map[Seq[Any], Seq[PipelineRowJson.Row]] =
        rows.groupBy(row => groupByFields.map(name => row.getOrElse(name, null)))

      grouped.map { case (keyValues, groupRows) =>
        val keyMap: PipelineRowJson.Row = groupByFields.zip(keyValues).toMap
        val aggMap: PipelineRowJson.Row = aggregations.map { agg =>
          val alias = agg.alias
          val fn    = agg.fn.toLowerCase
          val field = agg.field
          val nums  = groupRows.flatMap(r => PipelineRowJson.toDouble(r.getOrElse(field, null)))
          if (!SupportedFunctions.contains(fn))
            throw new IllegalArgumentException(
              "Unsupported aggregation function: " + fn +
                ". Supported: " + SupportedFunctions.mkString(", ")
            )
          val value: Any = fn match {
            case "sum"   => nums.sum
            case "avg"   => if (nums.isEmpty) null else nums.sum / nums.size
            case "min"   => if (nums.isEmpty) null else nums.min
            case "max"   => if (nums.isEmpty) null else nums.max
            case "count" => groupRows.count(r => r.getOrElse(field, null) != null).toLong
          }
          alias -> value
        }.toMap
        keyMap ++ aggMap
      }.toSeq
    }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = AggregateConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[AggregateConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[AggregateConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[AggregateConfig].toJson
  }
}
