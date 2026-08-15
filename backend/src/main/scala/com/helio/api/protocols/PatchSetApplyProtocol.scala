package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

// ── Patch-set apply response types (HEL-406) ─────────────────────────────────
//
// `PatchSetApplyService.apply` (see design.md D4/D4a/D4b) returns one
// `EditOutcome` per edit in the caller's given order. `priorState`/
// `resultingState` reuse each target kind's EXISTING response shape
// (PanelResponse/DashboardResponse/DataSourceResponse/DataTypeResponse/
// PipelineSummaryResponse/PipelineStepResponse) — never a new format invented
// for this ticket, so a future undo path (out of this ticket's scope) reads
// the exact same JSON shape any other caller of that resource kind already
// gets.

/** One edit's outcome. `status` is one of `applied` (everything succeeded,
 *  no rollback needed), `rolledBack` (a `create`/`update` edit was undone
 *  after a later edit in the same set failed), `recreated` (a `delete` edit
 *  was rolled back by recreating the resource's content under a NEW id —
 *  panel/pipelineStep only, design.md D3a), or `unrecoverable` (a `delete`
 *  edit's rollback could not restore the resource at all — dashboard/
 *  dataSource/dataType/pipeline, design.md D1).
 *
 *  `newId` is populated for a successful `create` (the freshly minted id)
 *  and for a `recreated` delete-rollback (the new id replacing the deleted
 *  one); `None` otherwise. `priorState` is populated for every `update`/
 *  `delete` edit regardless of final `status` (design.md D4a) — even an
 *  `unrecoverable` delete's prior state is real, useful material for a
 *  future undo attempt. `resultingState` is populated for every successful
 *  `create`/`update` edit and for a `recreated` delete-rollback (design.md
 *  D4b); `None` for a plain `delete` and for an `unrecoverable` rollback. */
final case class EditOutcome(
    index: Int,
    status: String,
    newId: Option[String],
    priorState: Option[JsValue],
    resultingState: Option[JsValue]
)

/** `failure`, when present, carries the message of the edit that triggered a
 *  mid-set rollback — `edits` then reports only the edits that were actually
 *  applied-then-compensated (design.md D3). `failure` is absent when every
 *  edit in the set applied cleanly, in which case every `EditOutcome.status`
 *  is `applied`.
 *
 *  `applicationId` (HEL-413 design.md D2) is additive: present exactly when
 *  `failure` is absent AND the application was successfully journaled —
 *  `POST /api/patch-sets/:id/undo` accepts it later to restore this apply's
 *  pre-apply state. `None` for a partially-rolled-back apply (nothing
 *  coherent to undo beyond what the rollback already restored) and for any
 *  caller that predates this field — byte-for-byte unchanged otherwise. */
final case class PatchSetApplyResponse(edits: Vector[EditOutcome], failure: Option[String], applicationId: Option[String] = None)

trait PatchSetApplyProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val editOutcomeFormat: RootJsonFormat[EditOutcome] = jsonFormat5(EditOutcome.apply)
  implicit val patchSetApplyResponseFormat: RootJsonFormat[PatchSetApplyResponse] =
    jsonFormat3(PatchSetApplyResponse.apply)
}
