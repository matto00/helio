package com.helio.domain.shapes

import com.helio.domain.steps.{AggregateConfig, AggregateField, AggregateStep, Aggregation, PivotConfig, PivotStep}
import spray.json._

/** Reshapes a source into a crosstab via an optional pre-aggregate followed by `pivot` (HEL-337
 *  "smart pipeline shapes", HEL-398) — the fourth and last concrete shape, after `single-row`
 *  (HEL-393), `top-n` (HEL-394), and `time-series` (HEL-396). Built on `PivotStep` (HEL-375) and
 *  `AggregateStep`. No new step kinds.
 *
 *  `expand` conditionally emits a pre-collapsing `aggregate` step ahead of `pivot` (design.md
 *  Decision 1): when `agg` is a genuine reducer supported by `AggregateStep`
 *  (`sum`/`avg`/`min`/`max`/`count`), an `aggregate` step (`groupBy = index :+ column`, one
 *  aggregation reducing `values` via `agg`, alias `values`) runs first, collapsing duplicate
 *  `(index, column)` pairs, and `pivot` then runs with its own `agg` hardcoded to the literal
 *  `"first"` (design.md Decision 2) — the preceding aggregate step has already collapsed each
 *  bucket to a single row, so any reduction function would return that row's value, and `"first"`
 *  is the cheapest correct choice. When `agg = "first"` — a value `AggregateStep.apply` has no
 *  case for at all — only `pivot` is emitted, using `PivotStep`'s own native
 *  first-row-in-bucket behavior; the `agg` written into `pivot`'s config is the canonical
 *  lowercase literal `"first"`, never the caller's original casing, because `PivotStep.apply`'s
 *  `cfg.agg` match is exact and case-sensitive (unlike `AggregateStep.apply`'s, which lowercases
 *  `fn` before matching).
 *
 *  Collision hazard (design.md Decision 4): `column ∈ index`, `values ∈ index`, and
 *  `values == column` are each rejected. The first two would let the pre-aggregate branch's
 *  `AggregateStep.apply` `keyMap ++ aggMap` merge silently overwrite a groupBy key with the
 *  aggregation result; the third is self-referential regardless of which branch runs — a field
 *  can't simultaneously be the column-spreading category and the aggregated measure. */
object PivotMatrixShape extends PipelineShape {

  val id: String          = "pivot-matrix"
  val label: String       = "Pivot / matrix"
  val description: String =
    "Reshapes a source into a crosstab: one row per distinct 'index' tuple, one column per " +
      "distinct 'column' value, via an optional pre-aggregate then pivot."

  // PivotStep's own supported set (a superset of AggregateStep's five — "first" has no
  // AggregateStep equivalent).
  private val SupportedAggs: Set[String]        = Set("sum", "count", "avg", "min", "max", "first")
  private val AggregateStepSupportedAggs: Set[String] = Set("sum", "avg", "min", "max", "count")

  val paramsSchema: Vector[ShapeParamDescriptor] = Vector(
    ShapeParamDescriptor(
      name        = "index",
      label       = "Index",
      dataType    = "string[]",
      required    = true,
      description = "Non-empty array of non-empty, non-duplicate source field names forming each " +
        "output row's key."
    ),
    ShapeParamDescriptor(
      name        = "column",
      label       = "Column",
      dataType    = "string",
      required    = true,
      description = "The source field whose distinct values become new output columns."
    ),
    ShapeParamDescriptor(
      name        = "values",
      label       = "Values",
      dataType    = "string",
      required    = true,
      description = "The source field whose values are aggregated into each pivoted cell."
    ),
    ShapeParamDescriptor(
      name        = "agg",
      label       = "Aggregation",
      dataType    = "string",
      required    = true,
      description = "One of sum/count/avg/min/max/first (case-insensitive). sum/avg/min/max/count " +
        "pre-collapse duplicate (index, column) pairs via an aggregate step before pivoting; " +
        "first pivots directly, using pivot's own native first-row-wins behavior."
    )
  )

  val outputContract: OutputContract = OutputContract(
    rowCount = RowCountContract.Unbounded,
    fields   = Vector.empty,
    description =
      "One row per distinct 'index' tuple present in the source; value-column names " +
        "('<values>_<column-value>') are data-dependent and never statically enumerated, mirroring " +
        "pivot's own analyze-time index-only schema (HEL-375)."
  )

  def expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]] =
    for {
      index  <- validateIndex(params)
      column <- validateColumn(params)
      values <- validateValues(params)
      agg    <- validateAgg(params)
      _      <- validateCollisions(index, column, values)
    } yield buildExpansion(index, column, values, agg)

  private def buildExpansion(
      index: Vector[String],
      column: String,
      values: String,
      agg: String
  ): Vector[ShapeStepExpansion] =
    if (AggregateStepSupportedAggs.contains(agg.toLowerCase))
      Vector(
        ShapeStepExpansion(
          kind = AggregateStep.Kind,
          config = AggregateConfig(
            groupBy      = (index :+ column).map(AggregateField(_, "string")),
            aggregations = Vector(Aggregation(alias = values, fn = agg, field = values))
          ).toJson.asJsObject
        ),
        ShapeStepExpansion(
          kind   = PivotStep.Kind,
          config = PivotConfig(index, column, values, agg = "first").toJson.asJsObject
        )
      )
    else
      Vector(
        ShapeStepExpansion(
          kind   = PivotStep.Kind,
          config = PivotConfig(index, column, values, agg = "first").toJson.asJsObject
        )
      )

  private def validateIndex(params: JsObject): Either[String, Vector[String]] =
    params.fields.get("index") match {
      case Some(JsArray(items)) if items.nonEmpty =>
        val names = items.collect { case JsString(s) => s }
        if (names.length != items.length || names.exists(_.isEmpty))
          Left("pivot-matrix shape: 'index' must be an array of non-empty strings")
        else if (names.distinct.length != names.length)
          Left(s"pivot-matrix shape: 'index' contains duplicate field name(s): ${names.mkString(", ")}")
        else
          Right(names)
      case _ =>
        Left("pivot-matrix shape: missing required field 'index' (expected a non-empty array of strings)")
    }

  private def validateColumn(params: JsObject): Either[String, String] =
    params.fields.get("column") match {
      case Some(JsString(column)) if column.nonEmpty => Right(column)
      case _ =>
        Left("pivot-matrix shape: missing required field 'column' (expected a non-empty string)")
    }

  private def validateValues(params: JsObject): Either[String, String] =
    params.fields.get("values") match {
      case Some(JsString(values)) if values.nonEmpty => Right(values)
      case _ =>
        Left("pivot-matrix shape: missing required field 'values' (expected a non-empty string)")
    }

  private def validateAgg(params: JsObject): Either[String, String] =
    params.fields.get("agg") match {
      case Some(JsString(agg)) if SupportedAggs.contains(agg.toLowerCase) => Right(agg)
      case Some(JsString(other)) =>
        Left(
          s"pivot-matrix shape: unknown 'agg' value '$other'. " +
            s"Valid values: ${SupportedAggs.toSeq.sorted.mkString(", ")}"
        )
      case _ =>
        Left(
          "pivot-matrix shape: missing required field 'agg' (expected one of " +
            s"${SupportedAggs.toSeq.sorted.mkString(", ")})"
        )
    }

  private def validateCollisions(index: Vector[String], column: String, values: String): Either[String, Unit] =
    if (index.contains(column))
      Left(s"pivot-matrix shape: 'column' ('$column') collides with 'index' — a field cannot be both a " +
        "row key and the column-spreading category")
    else if (index.contains(values))
      Left(s"pivot-matrix shape: 'values' ('$values') collides with 'index' — the pre-aggregate would " +
        "overwrite a row-key value")
    else if (values == column)
      Left(s"pivot-matrix shape: 'values' ('$values') collides with 'column' — a field cannot be both " +
        "the aggregated measure and the column-spreading category")
    else
      Right(())
}
