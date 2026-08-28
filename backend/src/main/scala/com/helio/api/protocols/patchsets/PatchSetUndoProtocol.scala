package com.helio.api.protocols.patchsets

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

//
// `PatchSetUndoService.undo` (design.md D4/D5) returns one `EditUndoOutcome` per journaled edit,
// in ascending `index` order (mirrors `PatchSetApplyResponse.edits`'s own convention). Unlike
// `apply`'s `EditOutcome`, there is no `priorState` here — the whole point of undo is restoring
// a KNOWN prior state, not capturing a new one for a future compensation.

/** One edit's undo outcome. `status` is one of `restored` (an `update` edit's captured
 *  pre-apply state was reapplied, or a `create` edit's created resource was deleted),
 *  `recreated` (a `delete` edit's resource was recreated under a NEW id — panel/pipelineStep
 *  only, mirrors `EditOutcome`'s identical rollback-side status), `failed` (a genuine, Phase-1-
 *  undetectable restore failure for THIS edit), or `notAttempted` (never reached because an
 *  earlier edit in the same reverse walk failed — design.md D4's narrower third guarantee tier).
 *
 *  `newId` is populated for a `recreated` delete-undo (the new id replacing the deleted one) AND
 *  for a `restored` create-undo (the just-deleted resource's OWN id — skeptic-final-2.md CR1:
 *  since a create-undo's `resultingState`/`priorState` are both unavailable once the resource is
 *  gone, this is the only field left on the wire that can tell a caller WHICH resource was
 *  removed, needed e.g. to invalidate a client-side cache keyed by that id); `None` for every
 *  other status. `resultingState` is populated for a successful `restored` update or a
 *  `recreated` delete-undo; `None` for a `restored` create-undo (the resource was deleted), a
 *  `failed`, or a `notAttempted` edit. */
final case class EditUndoOutcome(
    index: Int,
    status: String,
    newId: Option[String],
    resultingState: Option[JsValue]
)

final case class PatchSetUndoResponse(edits: Vector[EditUndoOutcome])

trait PatchSetUndoProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val editUndoOutcomeFormat: RootJsonFormat[EditUndoOutcome] = jsonFormat4(EditUndoOutcome.apply)
  implicit val patchSetUndoResponseFormat: RootJsonFormat[PatchSetUndoResponse] =
    jsonFormat1(PatchSetUndoResponse.apply)
}
