package com.helio.services.proposals

import com.helio.ai.{ClaudeMessage, ClaudeRole}
import com.helio.api.protocols.proposals.{AuthoringDisplayTurn, DashboardProposal}
import com.helio.domain.model.{AuthenticatedUser, AuthoringConversationId}
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository.AuthoringConversationRecord

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Conversation-turn persistence glue for `DashboardAuthoringService` (HEL-397 design.md D1-D6) —
 *  kept in its own file so `DashboardAuthoringService` doesn't grow past CONTRIBUTING's ~250-line
 *  soft budget. Wraps `AuthoringConversationRepository` with the higher-level "persist turn 1" /
 *  "append turn N+1" operations the service needs; holds no Claude-calling logic of its own. */
final class AuthoringConversationTurns(repo: AuthoringConversationRepository)(implicit ec: ExecutionContext) {

  /** The deterministic, human-readable summary an assistant turn's `display_turns` entry carries
   *  (design.md D6) — NEVER the model's raw JSON output. Mirrors
   *  `useDashboardAuthoringStream`'s existing "don't render `progressText` verbatim" precedent on
   *  the frontend, which independently computes the identical string for a live (non-reload) turn. */
  def summaryFor(proposal: DashboardProposal): String =
    s"""Proposed "${proposal.dashboardName}" (${proposal.panels.size} panel(s))"""

  /** Persists turn 1 of a brand-new conversation — always already-successful (design.md D3's
   *  migration comment: a row is only ever created once a proposal has parsed + validated). */
  def persistNew(
      user: AuthenticatedUser,
      userGoalText: String,
      userMessage: ClaudeMessage,
      finalResponseText: String,
      proposal: DashboardProposal,
      tokensUsed: Int
  ): Future[AuthoringConversationRecord] = {
    val now = Instant.now()
    repo.create(
      AuthoringConversationRecord(
        id              = AuthoringConversationId(UUID.randomUUID().toString),
        ownerId         = user.id,
        apiHistory      = Vector(userMessage, ClaudeMessage(ClaudeRole.Assistant, finalResponseText)),
        displayTurns    = Vector(AuthoringDisplayTurn("user", userGoalText), AuthoringDisplayTurn("assistant", summaryFor(proposal))),
        latestProposal  = Some(proposal),
        // HEL-411 design.md D3: this flow's own column only — never inferred, always explicit.
        latestPatchSet  = None,
        totalTokensUsed = tokensUsed,
        createdAt       = now,
        updatedAt       = now
      )
    )
  }

  /** Appends turn N+1 onto an already-loaded conversation record — the FULL prior `apiHistory`
   *  (never the trimmed subset `DashboardAuthoringService` sent to Claude for THIS call —
   *  `AuthoringHistoryBudget.trim` applies per-call, never permanently to storage, design.md D4)
   *  plus this turn's user+assistant pair. */
  def persistContinuation(
      prior: AuthoringConversationRecord,
      user: AuthenticatedUser,
      userGoalText: String,
      userMessage: ClaudeMessage,
      finalResponseText: String,
      proposal: DashboardProposal,
      turnTokensUsed: Int
  ): Future[Option[AuthoringConversationRecord]] =
    repo.appendTurn(
      id              = prior.id,
      user            = user,
      apiHistory      = prior.apiHistory ++ Vector(userMessage, ClaudeMessage(ClaudeRole.Assistant, finalResponseText)),
      displayTurns    = prior.displayTurns ++ Vector(AuthoringDisplayTurn("user", userGoalText), AuthoringDisplayTurn("assistant", summaryFor(proposal))),
      latestProposal  = Some(proposal),
      // HEL-411 design.md D3: this flow's own column only — never inferred, always explicit.
      latestPatchSet  = None,
      totalTokensUsed = prior.totalTokensUsed + turnTokensUsed,
      updatedAt       = Instant.now()
    )
}
