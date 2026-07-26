package com.helio.domain.shapes

import com.helio.domain.steps.{
  AggregateConfig,
  AggregateStep,
  Aggregation,
  FilterCondition,
  FilterConfig,
  FilterStep,
  LimitConfig,
  LimitStep
}
import spray.json._

import scala.util.Try

/** Reduces a source to exactly one row (HEL-337 "smart pipeline shapes",
 *  HEL-393) — the first concrete shape after HEL-391's `passthrough`
 *  reference. Two modes, selected by a required `"mode"` param, both reusing
 *  existing step kinds (design.md Decision 1/2 — no new pipeline op):
 *
 *    - `"aggregate"`: a non-empty `"measures"` array of `{ fn, field, alias }`
 *      (reusing [[com.helio.domain.steps.Aggregation]]'s wire shape) expands
 *      to one `aggregate` step with an empty `groupBy`, collapsing all rows
 *      into a single group.
 *    - `"filter"`: a non-empty `"conditions"` array of
 *      `{ field, operator, value }` (reusing
 *      [[com.helio.domain.steps.FilterCondition]]'s wire shape) plus an
 *      optional `"combinator"` expands to a `filter` step followed by a
 *      `limit` step with `count = 1`.
 *
 *  `expand` validates `fn`/`operator`/`combinator` against each step's known
 *  value set and rejects duplicate measure aliases before any step is built
 *  (design.md Decision 3) — a stricter, `Left`-returning failure mode than
 *  either underlying step's own runtime behavior.
 *
 *  Known limitation (design.md Risks): `ExactlyOne` is a declared contract,
 *  not runtime-enforced — a `"filter"`-mode call whose conditions match zero
 *  source rows still yields zero rows at execution. */
object SingleRowShape extends PipelineShape {

  val id: String          = "single-row"
  val label: String       = "Single row"
  val description: String =
    "Reduces a source to exactly one row, by aggregation (empty groupBy) or filter-to-one."

  private val SupportedFns: Set[String] = Set("sum", "avg", "min", "max", "count")

  private val SupportedOperators: Set[String] =
    Set("=", "!=", ">", ">=", "<", "<=", "contains", "is null", "is not null")

  private val SupportedCombinators: Set[String] = Set("AND", "OR")

  val paramsSchema: Vector[ShapeParamDescriptor] = Vector(
    ShapeParamDescriptor(
      name        = "mode",
      label       = "Mode",
      dataType    = "string",
      required    = true,
      description = "Either \"aggregate\" (reduce via measures) or \"filter\" (reduce via filter + limit 1)."
    ),
    ShapeParamDescriptor(
      name        = "measures",
      label       = "Measures",
      dataType    = "object[]",
      required    = false,
      description = "Required when mode is \"aggregate\": non-empty array of { fn, field, alias }; " +
        "fn must be one of sum/avg/min/max/count and aliases must be unique."
    ),
    ShapeParamDescriptor(
      name        = "conditions",
      label       = "Conditions",
      dataType    = "object[]",
      required    = false,
      description = "Required when mode is \"filter\": non-empty array of { field, operator, value }; " +
        "operator must be one of =, !=, >, >=, <, <=, contains, is null, is not null."
    ),
    ShapeParamDescriptor(
      name        = "combinator",
      label       = "Combinator",
      dataType    = "string",
      required    = false,
      description = "Optional when mode is \"filter\": \"AND\" or \"OR\" (case-insensitive); defaults to \"AND\"."
    )
  )

  val outputContract: OutputContract = OutputContract(
    rowCount    = RowCountContract.ExactlyOne,
    description = "Reduces the source to exactly one row, via an empty-groupBy aggregate or a filter+limit-1."
  )

  def expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]] =
    params.fields.get("mode") match {
      case Some(JsString("aggregate")) => expandAggregate(params)
      case Some(JsString("filter"))    => expandFilter(params)
      case Some(JsString(other)) =>
        Left(s"single-row shape: unknown 'mode' value '$other'. Valid values: aggregate, filter")
      case _ =>
        Left("single-row shape: missing required field 'mode' (expected \"aggregate\" or \"filter\")")
    }

  // ── aggregate mode ─────────────────────────────────────────────────────

  private def expandAggregate(params: JsObject): Either[String, Vector[ShapeStepExpansion]] =
    params.fields.get("measures") match {
      case Some(JsArray(items)) if items.nonEmpty =>
        val measures = items.flatMap(it => Try(it.convertTo[Aggregation]).toOption)
        if (measures.length != items.length)
          Left("single-row shape: 'measures' must be an array of { fn, field, alias } objects")
        else
          validateMeasures(measures).map { valid =>
            Vector(
              ShapeStepExpansion(
                kind   = AggregateStep.Kind,
                config = AggregateConfig(groupBy = Vector.empty, aggregations = valid).toJson.asJsObject
              )
            )
          }
      case Some(JsArray(_)) =>
        Left("single-row shape: 'measures' must be a non-empty array when mode is \"aggregate\"")
      case _ =>
        Left(
          "single-row shape: missing required field 'measures' (expected a non-empty array of " +
            "{ fn, field, alias } objects) when mode is \"aggregate\""
        )
    }

  private def validateMeasures(measures: Vector[Aggregation]): Either[String, Vector[Aggregation]] =
    measures.find(m => !SupportedFns.contains(m.fn.toLowerCase)) match {
      case Some(bad) =>
        Left(
          s"single-row shape: unsupported aggregation function '${bad.fn}'. " +
            s"Supported: ${SupportedFns.toSeq.sorted.mkString(", ")}"
        )
      case None =>
        measures.find(m => m.field.isEmpty || m.alias.isEmpty) match {
          case Some(_) =>
            Left("single-row shape: each measure requires a non-empty 'field' and 'alias'")
          case None =>
            val duplicateAliases = measures.groupBy(_.alias).collect { case (alias, ms) if ms.size > 1 => alias }
            if (duplicateAliases.nonEmpty)
              Left(s"single-row shape: duplicate measure alias(es): ${duplicateAliases.toSeq.sorted.mkString(", ")}")
            else
              Right(measures)
        }
    }

  // ── filter mode ────────────────────────────────────────────────────────

  private def expandFilter(params: JsObject): Either[String, Vector[ShapeStepExpansion]] =
    params.fields.get("conditions") match {
      case Some(JsArray(items)) if items.nonEmpty =>
        val conditions = items.flatMap(it => Try(it.convertTo[FilterCondition]).toOption)
        if (conditions.length != items.length)
          Left("single-row shape: 'conditions' must be an array of { field, operator, value } objects")
        else
          for {
            combinator      <- decodeCombinator(params)
            validConditions <- validateConditions(conditions)
          } yield Vector(
            ShapeStepExpansion(
              kind   = FilterStep.Kind,
              config = FilterConfig(combinator, validConditions).toJson.asJsObject
            ),
            ShapeStepExpansion(kind = LimitStep.Kind, config = LimitConfig(1).toJson.asJsObject)
          )
      case Some(JsArray(_)) =>
        Left("single-row shape: 'conditions' must be a non-empty array when mode is \"filter\"")
      case _ =>
        Left(
          "single-row shape: missing required field 'conditions' (expected a non-empty array of " +
            "{ field, operator, value } objects) when mode is \"filter\""
        )
    }

  private def decodeCombinator(params: JsObject): Either[String, String] =
    params.fields.get("combinator") match {
      case Some(JsString(c)) if SupportedCombinators.contains(c.toUpperCase) => Right(c.toUpperCase)
      case Some(JsString(c)) => Left(s"single-row shape: unsupported combinator '$c'. Valid values: AND, OR")
      case None               => Right("AND")
      case Some(_)            => Left("single-row shape: 'combinator' must be a string (\"AND\" or \"OR\")")
    }

  private def validateConditions(conditions: Vector[FilterCondition]): Either[String, Vector[FilterCondition]] =
    conditions.find(c => !SupportedOperators.contains(c.operator)) match {
      case Some(bad) =>
        Left(
          s"single-row shape: unsupported operator '${bad.operator}'. " +
            s"Supported: ${SupportedOperators.toSeq.sorted.mkString(", ")}"
        )
      case None =>
        conditions.find(_.field.isEmpty) match {
          case Some(_) => Left("single-row shape: each condition requires a non-empty 'field'")
          case None    => Right(conditions)
        }
    }
}
