package com.helio.api.protocols.patchsets

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

// ── Conversational refinement API types (HEL-411) ────────────────────────────
//
// POST /api/refinements's wire shape. See `com.helio.services.RefinementService` for how these are
// built — live-state grounding (D1) + workspace context (HEL-345) + panel-capability menu (HEL-365)
// into a prompt, a Claude call (HEL-390), parse, and validation via `PatchSetPreviewService.preview`
// (HEL-408) — the SAME "reuse the apply path's own validation" pattern `DashboardAuthoringService`
// uses via `DashboardProposalService.validate`. The endpoint never applies the returned patch set.

/** `kind` is `"dashboard"` or `"pipeline"` — the two live-state targets a refinement turn can ground
 *  against (design.md D1). Unlike `EditTarget` (`PatchSetProtocol`), `id` is REQUIRED here: a
 *  refinement always targets one specific, already-existing resource — there is no "create" analogue
 *  at the target-scope level (an `Edit` inside the returned `PatchSet` can still be `op: "create"`). */
final case class RefinementTarget(kind: String, id: String)

/** `conversationId` (design.md D3) mirrors `DashboardAuthoringRequest.conversationId` exactly:
 *  absent → a fresh conversation; present → continues that (owner-scoped, persisted, SAME-flow-only
 *  per design.md D3a) conversation, re-using `message` as "this turn's message." History and the
 *  working patch set are entirely server-owned — the client never re-sends either. */
final case class RefinementRequest(target: RefinementTarget, message: String, conversationId: Option[String] = None)

/** `patchSet` is already proven valid (design.md D2 — run through `PatchSetPreviewService.preview`
 *  before this response is ever built) and unapplied — the caller reviews it (`/patch-sets/review`)
 *  and applies it via the existing `POST /api/patch-sets/apply` (HEL-406) explicitly.
 *  `conversationId` (design.md D3) identifies the persisted conversation this turn belongs to — pass
 *  it back on the next call's `RefinementRequest.conversationId` to continue refining the same
 *  target. */
final case class RefinementResponse(patchSet: PatchSet, conversationId: String)

trait RefinementProtocol extends SprayJsonSupport with DefaultJsonProtocol with PatchSetProtocol {
  implicit val refinementTargetFormat: RootJsonFormat[RefinementTarget]   = jsonFormat2(RefinementTarget.apply)
  implicit val refinementRequestFormat: RootJsonFormat[RefinementRequest] = jsonFormat3(RefinementRequest.apply)
  implicit val refinementResponseFormat: RootJsonFormat[RefinementResponse] = jsonFormat2(RefinementResponse.apply)
}
