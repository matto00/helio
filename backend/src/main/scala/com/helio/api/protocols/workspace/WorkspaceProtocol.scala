package com.helio.api.protocols.workspace

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._


/** `tag`/`dryRun` are both `Option` on the wire per design.md Decision 8 —
 *  absent-from-JSON and explicit-`null` both normalize to `None` at the
 *  service boundary (`WorkspaceTeardownService`), which treats a missing
 *  `tag` as a 400 and a missing `dryRun` as `false`. */
final case class TeardownRequest(tag: Option[String], dryRun: Option[Boolean])

final case class TeardownConflictResponse(
    resourceKind: String,
    resourceId: String,
    resourceName: String,
    reason: String
)

// HEL-904 task 3.2: `typesDeleted` is REMOVED outright (not retargeted) --
// the `resourceKind = "data_type"` teardown branch no longer exists; Outputs
// cascade with their owning pipeline instead of being independently counted
// (see the `workspace-tag-teardown` OpenSpec delta).
final case class TeardownResponse(
    tag: String,
    dryRun: Boolean,
    committed: Boolean,
    blocked: Boolean,
    conflicts: Vector[TeardownConflictResponse],
    sourcesDeleted: Int,
    pipelinesDeleted: Int
)

trait WorkspaceProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val teardownRequestFormat: RootJsonFormat[TeardownRequest] = jsonFormat2(TeardownRequest.apply)
  implicit val teardownConflictResponseFormat: RootJsonFormat[TeardownConflictResponse] =
    jsonFormat4(TeardownConflictResponse.apply)
  implicit val teardownResponseFormat: RootJsonFormat[TeardownResponse] = jsonFormat7(TeardownResponse.apply)
}
