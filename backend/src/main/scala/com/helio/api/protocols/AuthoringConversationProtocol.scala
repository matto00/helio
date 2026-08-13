package com.helio.api.protocols

import spray.json._

// ── Multi-turn authoring-conversation reload/hydration API types (HEL-397) ──────────────────────
//
// GET /api/authoring/conversations/:id's response shape (design.md D3/D7). Deliberately
// DISPLAY-ONLY: `api_history` (the raw Vector[ClaudeMessage] needed to continue the Claude
// conversation) NEVER leaves the server — see `AuthoringConversationRepository` for that
// internal-only representation.

/** One human-readable turn — a user turn's own typed text verbatim, or a deterministic
 *  `"Proposed \"<name>\" (<n> panel(s))"` summary for an assistant turn (never raw model JSON,
 *  design.md D6). */
final case class AuthoringDisplayTurn(role: String, text: String)

/** The subset a reloaded chat surface needs to rehydrate a visible thread (design.md D7).
 *  `latestProposal` is `None` only in the theoretical case of a conversation row with no
 *  successful turn — in practice a row is only ever created once a turn has already parsed +
 *  validated (see `V77__authoring_conversations.sql`'s own comment), so this is always populated
 *  for a real, resolvable conversation id. */
final case class AuthoringConversationView(
    conversationId: String,
    displayTurns: Vector[AuthoringDisplayTurn],
    latestProposal: Option[DashboardProposal]
)

trait AuthoringConversationProtocol extends DefaultJsonProtocol with DashboardProposalProtocol {
  implicit val authoringDisplayTurnFormat: RootJsonFormat[AuthoringDisplayTurn] =
    jsonFormat2(AuthoringDisplayTurn.apply)
  implicit val authoringConversationViewFormat: RootJsonFormat[AuthoringConversationView] =
    jsonFormat3(AuthoringConversationView.apply)
}
