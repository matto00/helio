package com.helio.api.protocols.pipelines

import com.helio.domain.engine.PipelineRowJson.Row
import spray.json._

/** HEL-1630: wire shapes for `POST /api/pipelines/:id/draft-preview`. The request is titled `DraftPreviewRequest` in
 *  `schemas/pipelines/draft-preview-request.schema.json` and each streamed line is one of [[DraftPreviewLine]]
 *  (`draft-preview-line.schema.json`). Cells travel losslessly (`$int`, `$long`, `$double`, see `DraftPreviewCells`);
 *  `rows` here are already decoded engine rows.
 *
 *  `listFrame` is accepted for the client evaluator's sake and ignored: the server engine has no list-frame notion. */
final case class DraftPreviewFrame(rows: Vector[Row], listFrame: Option[Boolean])

/** A synthetic client label for an input frame; never a stored root. */
final case class DraftPreviewRoot(id: String, rows: Vector[Row], listFrame: Option[Boolean])

/** A secondary data source's rows as the client holds them. `complete: false` means the client's copy is a partial cache,
 *  which the server never completes by reading the source. */
final case class DraftPreviewSource(rows: Vector[Row], complete: Boolean)

final case class DraftPreviewStepDef(
    id: String,
    kind: String,
    enabled: Boolean,
    parentStepId: Option[String],
    rootId: Option[String],
    position: Int,
    config: JsValue
)

final case class DraftPreviewRequest(
    roots: Vector[DraftPreviewRoot],
    steps: Vector[DraftPreviewStepDef],
    lanes: Map[String, DraftPreviewFrame],
    sources: Map[String, DraftPreviewSource],
    rowsStepId: Option[String]
)

/** One NDJSON line of the response. `toJson` is the committed wire shape; the field names are the contract. */
sealed trait DraftPreviewLine {
  def toJson: JsObject
}

object DraftPreviewLine {

  /** A column of a `step` line; `type` is `int|long|double|string|boolean|null|mixed`. */
  final case class DraftPreviewColumn(name: String, `type`: String)

  /** Why a step is not evaluated. */
  object Reason {
    val AiStep                 = "aiStep"
    val DownstreamOfAiStep     = "downstreamOfAiStep"
    val SourceNotSupplied      = "sourceNotSupplied"
    val LaneNotSupplied        = "laneNotSupplied"
    val DownstreamOfUnavailable = "downstreamOfUnavailable"
    val DownstreamOfError      = "downstreamOfError"
  }

  final case class DraftPreviewStepLine(step: String, count: Int, schema: Vector[DraftPreviewColumn]) extends DraftPreviewLine {
    def toJson: JsObject = JsObject(
      "type"   -> JsString("step"),
      "step"   -> JsString(step),
      "count"  -> JsNumber(count),
      "schema" -> JsArray(schema.map(c => JsObject("name" -> JsString(c.name), "type" -> JsString(c.`type`))))
    )
  }

  final case class DraftPreviewUnavailableLine(step: String, reason: String) extends DraftPreviewLine {
    def toJson: JsObject = JsObject("type" -> JsString("unavailable"), "step" -> JsString(step), "reason" -> JsString(reason))
  }

  final case class DraftPreviewErrorLine(step: String, message: String) extends DraftPreviewLine {
    def toJson: JsObject = JsObject("type" -> JsString("error"), "step" -> JsString(step), "message" -> JsString(message))
  }

  /** The one final line: the requested step's frame (already value-encoded, at most 1,000 rows), or `available: false`. */
  final case class DraftPreviewRowsLine(step: Option[String], available: Boolean, rows: Vector[JsObject], count: Int, truncated: Boolean)
      extends DraftPreviewLine {
    def toJson: JsObject = JsObject(
      "type"      -> JsString("rows"),
      "step"      -> step.fold[JsValue](JsNull)(JsString(_)),
      "available" -> JsBoolean(available),
      "rows"      -> JsArray(rows),
      "count"     -> JsNumber(count),
      "truncated" -> JsBoolean(truncated)
    )
  }

  /** An internal failure after the 200 was committed; carries no detail. */
  case object DraftPreviewFailedLine extends DraftPreviewLine {
    def toJson: JsObject = JsObject("type" -> JsString("failed"), "message" -> JsString("Draft preview failed"))
  }
}
