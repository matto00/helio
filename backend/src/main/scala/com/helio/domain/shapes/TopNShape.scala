package com.helio.domain.shapes

import com.helio.domain.steps.{LimitConfig, LimitStep, SortConfig, SortKey, SortStep}
import spray.json._

/** Sorts a source by a measure and keeps the top (or bottom) N rows (HEL-337 "smart pipeline
 *  shapes", HEL-394) — the second concrete shape after HEL-393's `single-row`. Expands to exactly
 *  two existing step kinds (design.md Decision 1): a `sort` step on a single key
 *  (`measure`/`direction`), then a `limit` step (`n`). No new step kinds.
 *
 *  Ties policy (design.md Decision 3): the only implemented `"ties"` value is `"strict"`
 *  (the default when absent), which relies entirely on [[SortStep]]'s documented stable-sort
 *  guarantee — the boundary between the Nth and (N+1)th row is broken by each tied row's
 *  original input order, with no additional index bookkeeping introduced here. Any other `"ties"`
 *  value (e.g. a `"keep-ties"`/dense variant that would need the `window` op plus a per-partition
 *  rank filter) is rejected with a `Left` naming the deferral, rather than silently approximated.
 *
 *  Known limitation (design.md Risks): `AtMostParam("n")` is a declared contract, not
 *  runtime-enforced — the guarantee depends on the expanded `sort`+`limit` steps actually
 *  executing, mirroring `single-row`'s `ExactlyOne` posture. */
object TopNShape extends PipelineShape {

  val id: String          = "top-n"
  val label: String       = "Top N"
  val description: String =
    "Sorts a source by a measure and keeps the top (or bottom) N rows, via sort + limit."

  private val SupportedDirections: Set[String] = Set("asc", "desc")
  private val DefaultTies: String               = "strict"

  val paramsSchema: Vector[ShapeParamDescriptor] = Vector(
    ShapeParamDescriptor(
      name        = "measure",
      label       = "Measure",
      dataType    = "string",
      required    = true,
      description = "The field to sort by; must be a non-empty string."
    ),
    ShapeParamDescriptor(
      name        = "direction",
      label       = "Direction",
      dataType    = "string",
      required    = true,
      description = "Sort direction: \"asc\" or \"desc\" (case-insensitive)."
    ),
    ShapeParamDescriptor(
      name        = "n",
      label       = "N",
      dataType    = "integer",
      required    = true,
      description = "The row cap; must be a positive integer."
    ),
    ShapeParamDescriptor(
      name        = "ties",
      label       = "Ties policy",
      dataType    = "string",
      required    = false,
      description = "Optional tie-break policy; only \"strict\" is implemented (default when absent)."
    )
  )

  val outputContract: OutputContract = OutputContract(
    rowCount    = RowCountContract.AtMostParam("n"),
    description = "Sorts by a measure and keeps at most N rows; columns mirror the source unchanged."
  )

  def expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]] =
    for {
      measure   <- validateMeasure(params)
      direction <- validateDirection(params)
      n         <- validateN(params)
      _         <- validateTies(params)
    } yield Vector(
      ShapeStepExpansion(
        kind   = SortStep.Kind,
        config = SortConfig(Vector(SortKey(measure, direction))).toJson.asJsObject
      ),
      ShapeStepExpansion(kind = LimitStep.Kind, config = LimitConfig(n).toJson.asJsObject)
    )

  private def validateMeasure(params: JsObject): Either[String, String] =
    params.fields.get("measure") match {
      case Some(JsString(measure)) if measure.nonEmpty => Right(measure)
      case _ =>
        Left("top-n shape: missing required field 'measure' (expected a non-empty string)")
    }

  private def validateDirection(params: JsObject): Either[String, String] =
    params.fields.get("direction") match {
      case Some(JsString(direction)) if SupportedDirections.contains(direction.toLowerCase) =>
        Right(direction)
      case Some(JsString(other)) =>
        Left(s"top-n shape: unknown 'direction' value '$other'. Valid values: asc, desc")
      case _ =>
        Left("top-n shape: missing required field 'direction' (expected \"asc\" or \"desc\")")
    }

  private def validateN(params: JsObject): Either[String, Int] =
    params.fields.get("n") match {
      case Some(JsNumber(n)) if n.isValidInt && n.toIntExact > 0 => Right(n.toIntExact)
      case Some(JsNumber(n)) if n.isValidInt =>
        Left(s"top-n shape: 'n' must be a positive integer, got ${n.toIntExact}")
      case Some(_) =>
        Left("top-n shape: 'n' must be a positive integer")
      case None =>
        Left("top-n shape: missing required field 'n' (expected a positive integer)")
    }

  private def validateTies(params: JsObject): Either[String, String] =
    params.fields.get("ties") match {
      case None                                     => Right(DefaultTies)
      case Some(JsString(DefaultTies))               => Right(DefaultTies)
      case Some(JsString(other)) =>
        Left(
          s"top-n shape: unsupported 'ties' value '$other'. Only \"strict\" is implemented; a " +
            "\"keep-ties\"/dense variant would require the 'window' op and per-partition filtering " +
            "(see HEL-337 follow-up) and is not yet supported."
        )
      case Some(_) =>
        Left("top-n shape: 'ties' must be a string when present")
    }
}
