package com.helio.api.protocols.proposals

import com.helio.api.protocols.patchsets.{PatchSet, PatchSetProtocol}
import spray.json._

// ── Multi-turn authoring/refinement-conversation reload/hydration API types (HEL-397, generalized
//
// GET /api/authoring/conversations/:id's response shape (design.md D3/D7, HEL-411 design.md D4).
// Deliberately DISPLAY-ONLY: `api_history` (the raw Vector[ClaudeMessage] needed to continue the
// Claude conversation) NEVER leaves the server — see `AuthoringConversationRepository` for that
// internal-only representation. Shared verbatim by BOTH flows (HEL-411 design.md D3 — one store,
// two mutually-exclusive outcome columns) rather than a parallel refinement-only view type.

/** One human-readable turn — a user turn's own typed text verbatim, or a deterministic assistant
 *  summary (`AuthoringConversationTurns.summaryFor`'s `"Proposed \"<name>\" (<n> panel(s))"`, or
 *  `RefinementConversationTurns.summaryFor`'s patch-set analogue) — never raw model JSON, design.md
 *  D6. */
final case class AuthoringDisplayTurn(role: String, text: String)

/** The subset a reloaded chat surface needs to rehydrate a visible thread (design.md D7, HEL-411
 *  design.md D4). Exactly one of `latestProposal`/`latestPatchSet` is ever populated for a real
 *  conversation id (design.md D3's mutual-exclusivity invariant) — `None` for BOTH only in the
 *  theoretical case of a conversation row with no successful turn, which in practice never exists
 *  (see `V77__authoring_conversations.sql`'s own comment: a row is only ever created once a turn has
 *  already parsed + validated). */
final case class AuthoringConversationView(
    conversationId: String,
    displayTurns: Vector[AuthoringDisplayTurn],
    latestProposal: Option[DashboardProposal],
    latestPatchSet: Option[PatchSet]
)

trait AuthoringConversationProtocol extends DefaultJsonProtocol with DashboardProposalProtocol with PatchSetProtocol {
  implicit val authoringDisplayTurnFormat: RootJsonFormat[AuthoringDisplayTurn] =
    jsonFormat2(AuthoringDisplayTurn.apply)
  implicit val authoringConversationViewFormat: RootJsonFormat[AuthoringConversationView] =
    jsonFormat4(AuthoringConversationView.apply)
}
