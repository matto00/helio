package com.helio.domain.shapes

import com.helio.domain.steps.{SelectConfig, SelectStep}
import spray.json._

/** The trivial reference shape (HEL-391 design.md Decision 7) — registered for real, proving the
 *  `PipelineShape` abstraction end-to-end and anchoring this ticket's tests. Not one of the four
 *  concrete shapes (single-row/top-N/time-series/pivot) those sibling tickets own; chosen
 *  deliberately to reuse the simplest existing step kind (`select`) so this ticket doesn't presume
 *  or foreclose any sibling shape's design.
 *
 *  Params: `fields: Vector[String]`, required and non-empty. Expands to exactly one `select` step.
 *  Output contract: `Unbounded` row count (row count is whatever the source produced) with an empty
 *  `fields` list, since the output field set is exactly whatever the caller passed in
 *  `params.fields` — fully param-driven, not fixed by the shape itself. */
object PassthroughShape extends PipelineShape {

  val id: String          = "passthrough"
  val label: String       = "Passthrough"
  val description: String = "Passes source rows through, narrowed to the selected fields."

  val paramsSchema: Vector[ShapeParamDescriptor] = Vector(
    ShapeParamDescriptor(
      name        = "fields",
      label       = "Fields",
      dataType    = "string[]",
      required    = true,
      description = "Non-empty list of field names to select from the source rows."
    )
  )

  val outputContract: OutputContract = OutputContract(
    rowCount    = RowCountContract.Unbounded,
    fields      = Vector.empty,
    description = "Passes source rows through, narrowed to the selected fields"
  )

  def expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]] =
    params.fields.get("fields") match {
      case Some(JsArray(items)) if items.nonEmpty =>
        val fields = items.collect { case JsString(s) => s }
        if (fields.length != items.length)
          Left("passthrough shape: 'fields' must be an array of strings")
        else
          Right(Vector(ShapeStepExpansion(kind = SelectStep.Kind, config = SelectConfig(fields).toJson.asJsObject)))
      case Some(JsArray(_)) =>
        Left("passthrough shape: 'fields' must be a non-empty array of strings")
      case _ =>
        Left("passthrough shape: missing required field 'fields' (expected a non-empty array of strings)")
    }
}
