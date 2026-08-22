package com.helio.services.patchsets

import com.helio.ai.{ClaudeMessage, ClaudeRole}
import com.helio.api.protocols.proposals.AuthoringDisplayTurn
import com.helio.api.protocols.patchsets.PatchSet
import com.helio.domain.model.{AuthenticatedUser, AuthoringConversationId}
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository.AuthoringConversationRecord

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Conversation-turn persistence glue for `RefinementService` (HEL-411 design.md D3) — sibling to
 *  `AuthoringConversationTurns`, NOT a modification of it (design.md D3: two turn-glue classes over
 *  ONE shared `AuthoringConversationRepository`, keeping both under CONTRIBUTING's ~250-line soft
 *  budget rather than growing one god class). Wraps `AuthoringConversationRepository` with the
 *  higher-level "persist turn 1" / "append turn N+1" operations `RefinementService` needs for its
 *  `PatchSet` outcome; holds no Claude-calling logic of its own.
 *
 *  Every write here populates `latestPatchSet` and passes `latestProposal = None` explicitly
 *  (design.md D3 — the dual-optional pair is always explicit, never inferred) — the mirror image of
 *  `AuthoringConversationTurns`, which always does the opposite. */
final class RefinementConversationTurns(repo: AuthoringConversationRepository)(implicit ec: ExecutionContext) {

  /** The deterministic, human-readable summary an assistant turn's `display_turns` entry carries
   *  (design.md D6 precedent, carried over from `AuthoringConversationTurns.summaryFor`) — NEVER the
   *  model's raw JSON output. Falls back to an edit count when the model didn't (or a repair
   *  round-trip didn't) produce a `summary`. Mirrors `refinementSummary.ts`'s
   *  `summarizeRefinementPatchSet` on the frontend byte-for-byte, so a live (just-completed) turn's
   *  thread entry and a reload-rehydrated one (`GET /api/authoring/conversations/:id`'s
   *  `displayTurns`) read identically. */
  def summaryFor(patchSet: PatchSet): String =
    patchSet.summary.map(_.trim).filter(_.nonEmpty).getOrElse {
      val n = patchSet.edits.size
      s"Proposed $n edit${if (n == 1) "" else "s"}"
    }

  /** Persists turn 1 of a brand-new conversation — always already-successful (mirrors
   *  `AuthoringConversationTurns.persistNew`: `RefinementService` only ever reaches this once a
   *  patch set has parsed + validated via `PatchSetPreviewService.preview`). */
  def persistNew(
      user: AuthenticatedUser,
      userMessageText: String,
      userMessage: ClaudeMessage,
      finalResponseText: String,
      patchSet: PatchSet,
      tokensUsed: Int
  ): Future[AuthoringConversationRecord] = {
    val now = Instant.now()
    repo.create(
      AuthoringConversationRecord(
        id              = AuthoringConversationId(UUID.randomUUID().toString),
        ownerId         = user.id,
        apiHistory      = Vector(userMessage, ClaudeMessage(ClaudeRole.Assistant, finalResponseText)),
        displayTurns    = Vector(AuthoringDisplayTurn("user", userMessageText), AuthoringDisplayTurn("assistant", summaryFor(patchSet))),
        // HEL-411 design.md D3: this flow's own column only — never inferred, always explicit.
        latestProposal  = None,
        latestPatchSet  = Some(patchSet),
        totalTokensUsed = tokensUsed,
        createdAt       = now,
        updatedAt       = now
      )
    )
  }

  /** Appends turn N+1 onto an already-loaded conversation record — the FULL prior `apiHistory`
   *  (never the trimmed subset `RefinementService` sent to Claude for THIS call —
   *  `AuthoringHistoryBudget.trim` applies per-call, never permanently to storage, mirrors design.md
   *  D4's authoring precedent) plus this turn's user+assistant pair. */
  def persistContinuation(
      prior: AuthoringConversationRecord,
      user: AuthenticatedUser,
      userMessageText: String,
      userMessage: ClaudeMessage,
      finalResponseText: String,
      patchSet: PatchSet,
      turnTokensUsed: Int
  ): Future[Option[AuthoringConversationRecord]] =
    repo.appendTurn(
      id              = prior.id,
      user            = user,
      apiHistory      = prior.apiHistory ++ Vector(userMessage, ClaudeMessage(ClaudeRole.Assistant, finalResponseText)),
      displayTurns    = prior.displayTurns ++ Vector(AuthoringDisplayTurn("user", userMessageText), AuthoringDisplayTurn("assistant", summaryFor(patchSet))),
      // HEL-411 design.md D3: this flow's own column only — never inferred, always explicit.
      latestProposal  = None,
      latestPatchSet  = Some(patchSet),
      totalTokensUsed = prior.totalTokensUsed + turnTokensUsed,
      updatedAt       = Instant.now()
    )
}
