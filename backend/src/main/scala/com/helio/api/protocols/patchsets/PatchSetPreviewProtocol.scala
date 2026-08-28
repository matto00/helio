package com.helio.api.protocols.patchsets

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

//
// `PatchSetPreviewService.preview` (design.md D5) returns one `EditPreview`
// per edit, in the caller's given order. `before`/`after` reuse each target
// kind's EXISTING response shape (PanelResponse/DashboardResponse/
// DataSourceResponse/DataTypeResponse/PipelineSummaryResponse/
// PipelineStepResponse) -- never a new format invented for this ticket, the
// same discipline PatchSetApplyProtocol's EditOutcome already follows.

/** One edit's before/after diff + impact hints. `before` is the resource's
 *  pre-edit state (design.md D2 -- `ResolvedEdit.priorStateJson` reused
 *  verbatim); `None` for a `create` edit. `after` is the PURELY IN-MEMORY
 *  projected post-edit state (design.md D3); `None` for a `delete` edit. A
 *  `create` edit's `after.id` carries the literal sentinel string
 *  `"(pending)"` -- never a value that could be mistaken for a real,
 *  minted id. `impact` surfaces cascade/staleness hints (design.md D4);
 *  empty when the edit has no such consequence. */
final case class EditPreview(
    index: Int,
    kind: String,
    op: String,
    before: Option[JsValue],
    after: Option[JsValue],
    impact: Vector[String]
)

final case class PatchSetPreviewResponse(edits: Vector[EditPreview])

trait PatchSetPreviewProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val editPreviewFormat: RootJsonFormat[EditPreview] = jsonFormat6(EditPreview.apply)
  implicit val patchSetPreviewResponseFormat: RootJsonFormat[PatchSetPreviewResponse] =
    jsonFormat1(PatchSetPreviewResponse.apply)
}
