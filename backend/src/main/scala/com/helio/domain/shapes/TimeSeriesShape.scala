package com.helio.domain.shapes

import com.helio.domain.steps.{
  AggregateConfig,
  AggregateField,
  AggregateStep,
  Aggregation,
  DateBucketConfig,
  DateBucketStep,
  SortConfig,
  SortKey,
  SortStep
}
import spray.json._

import scala.util.Try

/** Buckets a time column and aggregates measures over each bucket (HEL-337 "smart pipeline shapes",
 *  HEL-396) — the third concrete shape, after `single-row` (HEL-393) and `top-n` (HEL-394). Expands
 *  to exactly three existing step kinds (design.md Decision 1/2): a `datebucket` step that floors
 *  `timeField` to `granularity` and overwrites `timeField` in place (no `outputColumn`), an
 *  `aggregate` step that groups by the bucketed `timeField` and computes the `measures`, and a
 *  trailing `sort` step (always appended, ascending on `timeField`) — `AggregateStep`'s hash-map
 *  grouping gives no ordering guarantee on its own, and `DateBucketStep`'s canonical `yyyy-MM-dd`
 *  strings sort lexicographically in chronological order for every supported granularity. No new
 *  step kinds.
 *
 *  `granularity` is validated case-insensitively but normalized to lowercase before being written
 *  into `DateBucketConfig` (design.md Decision 4) — unlike `AggregateStep.fn`/`SortStep.direction`,
 *  `DateBucketStep.floorFn` matches `granularity` via an exact, case-sensitive match.
 *
 *  A measure `alias` colliding with `timeField` is rejected (design.md Decision 6):
 *  `AggregateStep.apply`'s `keyMap ++ aggMap` merge favors the right-hand side, so a colliding alias
 *  would silently overwrite the bucket value with the aggregation result.
 *
 *  Known limitation (design.md Risks): `Unbounded` is a declared contract, not runtime-enforced, and
 *  `AggregateStep` only emits groups that exist in the input — a bucket with zero source rows
 *  produces no output row at all (gap-filling is out of scope; filed as a HEL-337 spinoff,
 *  HEL-622). */
object TimeSeriesShape extends PipelineShape {

  val id: String          = "time-series"
  val label: String       = "Time series"
  val description: String =
    "Buckets a time column to a granularity and aggregates measures per bucket, via datebucket + " +
      "aggregate + sort."

  private val SupportedGranularities: Set[String] = Set("day", "week", "month", "quarter", "year")
  private val SupportedFns: Set[String]            = Set("sum", "avg", "min", "max", "count")

  val paramsSchema: Vector[ShapeParamDescriptor] = Vector(
    ShapeParamDescriptor(
      name        = "timeField",
      label       = "Time field",
      dataType    = "string",
      required    = true,
      description = "The timestamp field to bucket; must be a non-empty string."
    ),
    ShapeParamDescriptor(
      name        = "granularity",
      label       = "Granularity",
      dataType    = "string",
      required    = true,
      description = "Bucket width: one of day/week/month/quarter/year (case-insensitive)."
    ),
    ShapeParamDescriptor(
      name        = "measures",
      label       = "Measures",
      dataType    = "object[]",
      required    = true,
      description = "Non-empty array of { fn, field, alias }; fn must be one of sum/avg/min/max/count, " +
        "aliases must be unique, and no alias may equal 'timeField'."
    )
  )

  val outputContract: OutputContract = OutputContract(
    rowCount = RowCountContract.Unbounded,
    fields   = Vector.empty,
    description =
      "One row per distinct time bucket present in the source, ordered chronologically ascending; " +
        "columns are the bucket column (named after 'timeField') and the measure aliases."
  )

  def expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]] =
    for {
      timeField   <- validateTimeField(params)
      granularity <- validateGranularity(params)
      measures    <- validateMeasures(params, timeField)
    } yield Vector(
      ShapeStepExpansion(
        kind   = DateBucketStep.Kind,
        config = DateBucketConfig(timeField, granularity, outputColumn = None).toJson.asJsObject
      ),
      ShapeStepExpansion(
        kind = AggregateStep.Kind,
        config = AggregateConfig(
          groupBy      = Vector(AggregateField(timeField, "string")),
          aggregations = measures
        ).toJson.asJsObject
      ),
      ShapeStepExpansion(
        kind   = SortStep.Kind,
        config = SortConfig(Vector(SortKey(timeField, "asc"))).toJson.asJsObject
      )
    )

  private def validateTimeField(params: JsObject): Either[String, String] =
    params.fields.get("timeField") match {
      case Some(JsString(timeField)) if timeField.nonEmpty => Right(timeField)
      case _ =>
        Left("time-series shape: missing required field 'timeField' (expected a non-empty string)")
    }

  private def validateGranularity(params: JsObject): Either[String, String] =
    params.fields.get("granularity") match {
      case Some(JsString(granularity)) if SupportedGranularities.contains(granularity.toLowerCase) =>
        Right(granularity.toLowerCase)
      case Some(JsString(other)) =>
        Left(
          s"time-series shape: unknown 'granularity' value '$other'. " +
            s"Valid values: ${SupportedGranularities.toSeq.sorted.mkString(", ")}"
        )
      case _ =>
        Left(
          "time-series shape: missing required field 'granularity' (expected one of " +
            s"${SupportedGranularities.toSeq.sorted.mkString(", ")})"
        )
    }

  private def validateMeasures(params: JsObject, timeField: String): Either[String, Vector[Aggregation]] =
    params.fields.get("measures") match {
      case Some(JsArray(items)) if items.nonEmpty =>
        val measures = items.flatMap(it => Try(it.convertTo[Aggregation]).toOption)
        if (measures.length != items.length)
          Left("time-series shape: 'measures' must be an array of { fn, field, alias } objects")
        else
          validateMeasureContents(measures, timeField)
      case Some(JsArray(_)) =>
        Left("time-series shape: 'measures' must be a non-empty array")
      case _ =>
        Left(
          "time-series shape: missing required field 'measures' (expected a non-empty array of " +
            "{ fn, field, alias } objects)"
        )
    }

  private def validateMeasureContents(
      measures: Vector[Aggregation],
      timeField: String
  ): Either[String, Vector[Aggregation]] =
    measures.find(m => !SupportedFns.contains(m.fn.toLowerCase)) match {
      case Some(bad) =>
        Left(
          s"time-series shape: unsupported aggregation function '${bad.fn}'. " +
            s"Supported: ${SupportedFns.toSeq.sorted.mkString(", ")}"
        )
      case None =>
        measures.find(m => m.field.isEmpty || m.alias.isEmpty) match {
          case Some(_) =>
            Left("time-series shape: each measure requires a non-empty 'field' and 'alias'")
          case None =>
            val duplicateAliases =
              measures.groupBy(_.alias).collect { case (alias, ms) if ms.size > 1 => alias }
            if (duplicateAliases.nonEmpty)
              Left(
                s"time-series shape: duplicate measure alias(es): ${duplicateAliases.toSeq.sorted.mkString(", ")}"
              )
            else
              measures.find(_.alias == timeField) match {
                case Some(colliding) =>
                  Left(
                    s"time-series shape: measure alias '${colliding.alias}' collides with 'timeField' " +
                      s"('$timeField') — this would overwrite the bucket value"
                  )
                case None => Right(measures)
              }
        }
    }
}
