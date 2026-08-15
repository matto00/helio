package com.helio.services

import com.helio.ai.{ClaudeClient, ClaudeContentBlock, ClaudeError, ClaudeRole, ClaudeToolMessage, ClaudeToolOutcome, ClaudeToolRequest}
import com.helio.api.protocols.{AssistantProtocol, AssistantTurnResult}
import com.helio.domain.AuthenticatedUser

import scala.concurrent.{ExecutionContext, Future}

/** HEL-662 — the top-level assistant's (HEL-659) one entry point, superseding
 *  `DashboardAuthoringService` for the in-app assistant while reusing its validation/proposal
 *  collaborators rather than discarding them. Builds the static system prompt + the bounded 6-tool
 *  set, runs `ClaudeClient.sendWithTools` with `maxHops = 3` (design.md D2 — HEL-660's
 *  `ClaudeToolRequest.maxHops` finally gets its concrete, caller-supplied value here), and folds the
 *  outcome into a structured [[AssistantTurnResult]] carrying the actual `DashboardProposal`/
 *  `PipelineProposal`/`CombinedProposal`/`PatchSet` a successful `propose_*` call produced — never
 *  prose re-derived from Claude's final text (design.md D6).
 *
 *  `converse` takes an explicit, caller-supplied `history` parameter rather than a `conversationId`
 *  DB-backed lookup (design.md D1) — conversation persistence is HEL-663's job, a later ticket in
 *  this epic's delivery order; `history` lets that ticket slot a real load step in front of this
 *  loop unchanged.
 *
 *  Zero mutation anywhere in this class's reachable call graph: every `propose_*` tool
 *  (`AssistantToolExecutor`'s dispatch table) calls a NON-MUTATING `validate`/`preview` entry point,
 *  never `apply` — and `AssistantProtocol.assistantTools` never includes an apply-shaped tool in the
 *  first place, so Claude has no schema through which it could even request one (the Hard Boundary
 *  this whole epic is built around).
 *
 *  No DI/route wiring in this ticket (design.md D7/D8) — mirrors HEL-661's `WorkspaceSearchService`
 *  precedent: a fully real, fully tested, constructible class with zero live route. */
final class AssistantService(
    claudeClient: ClaudeClient,
    workspaceSearchService: WorkspaceSearchService,
    panelCapabilityService: PanelCapabilityService,
    dashboardProposalService: DashboardProposalService,
    pipelineProposalService: PipelineProposalService,
    combinedProposalService: CombinedProposalService,
    patchSetPreviewService: PatchSetPreviewService
)(implicit ec: ExecutionContext) {

  /** The bounded tool-use loop's hard hop cap (design.md D2) — HEL-660's own doc comment says this
   *  ticket's caller would supply `3`; never hardcoded inside `ClaudeClient` itself. */
  private val MaxHops: Int = 3

  /** HEL-665 (reopened composer ticket, design.md D1): `Future[Either[ClaudeError,
   *  AssistantTurnResult]]`, mirroring `ClaudeClient.send`'s own existing `Either` shape — the only
   *  way to represent `ClaudeToolOutcome.Failed` (which carries no `history` at all) without either
   *  silently discarding the user's message or fabricating a persisted "response" for a real API
   *  failure. */
  def converse(history: Seq[ClaudeToolMessage], message: String, user: AuthenticatedUser): Future[Either[ClaudeError, AssistantTurnResult]] = {
    val executor = new AssistantToolExecutor(
      workspaceSearchService,
      panelCapabilityService,
      dashboardProposalService,
      pipelineProposalService,
      combinedProposalService,
      patchSetPreviewService,
      user
    )
    val request = ClaudeToolRequest(
      history = seedHistory(history, message),
      tools = AssistantProtocol.assistantTools,
      maxHops = MaxHops
    )
    // `historyWasEmpty` is captured from the CALLER-supplied `history` (before `seedHistory` folds
    // AssistantSystemPrompt.text into it) — threaded through to `toTurnResult` so the RETURNED
    // `fullHistory` can be desanitized back down to the plain `message`, while `request` above
    // (what's actually sent to Claude) is completely unaffected (evaluation-1.md Change Request 1).
    val historyWasEmpty = history.isEmpty
    claudeClient.sendWithTools(request, executor).map(outcome => toTurnResult(outcome, executor, historyWasEmpty, message))
  }

  /** Folds the static [[AssistantSystemPrompt]] into the SAME message as the fresh user turn, only
   *  when `history` is empty — mirrors `DashboardAuthoringPrompt`'s own precedent for the identical
   *  constraint (no separate `system` field on `ClaudeToolRequest`; Anthropic's Messages API also
   *  requires strict user/assistant alternation, so this can never be a second, separately-appended
   *  `user` turn). A non-empty `history` is a continued conversation (HEL-663) whose turn 1 already
   *  carried this text — never re-injected. */
  private def seedHistory(history: Seq[ClaudeToolMessage], message: String): Seq[ClaudeToolMessage] = {
    val turnText = if (history.isEmpty) AssistantSystemPrompt.text + "\n\n" + message else message
    history :+ ClaudeToolMessage.text(ClaudeRole.User, turnText)
  }

  /** `FinalResponse`/`HopBudgetExhausted` both carry a real `history` — folded to `Right(...)`,
   *  `fullHistory` desanitized via [[desanitizeFirstTurn]] before being returned (design.md D1 +
   *  evaluation-1.md Change Request 1). `Failed` carries no `history` at all — folded to
   *  `Left(error)` directly, never a value-less or fabricated `AssistantTurnResult`. */
  private def toTurnResult(
      outcome: ClaudeToolOutcome,
      executor: AssistantToolExecutor,
      historyWasEmpty: Boolean,
      message: String
  ): Either[ClaudeError, AssistantTurnResult] = outcome match {
    case ClaudeToolOutcome.FinalResponse(text, fullHistory, usage) =>
      Right(
        AssistantTurnResult(text, executor.proposal, toolCallCount(fullHistory), hopBudgetExhausted = false, usage, desanitizeFirstTurn(fullHistory, historyWasEmpty, message))
      )
    case ClaudeToolOutcome.HopBudgetExhausted(fullHistory, usage) =>
      Right(
        AssistantTurnResult(
          s"Reached the maximum number of tool calls ($MaxHops) without a final response.",
          executor.proposal,
          toolCallCount(fullHistory),
          hopBudgetExhausted = true,
          usage,
          desanitizeFirstTurn(fullHistory, historyWasEmpty, message)
        )
      )
    case ClaudeToolOutcome.Failed(error) =>
      Left(error)
  }

  /** Undoes `seedHistory`'s system-prompt folding for the value actually RETURNED by `converse`
   *  (evaluation-1.md Change Request 1 — the outbound request Claude sees, built in `converse`
   *  above, is completely unaffected by this). `seedHistory` only folds `AssistantSystemPrompt.text`
   *  into the first turn when the caller's own `history` was empty (a brand-new conversation's first
   *  message) — that same condition (`historyWasEmpty`) is when `fullHistory.head` needs rewriting
   *  back down to the plain `message` before this value gets persisted (`AssistantConversationRoutes
   *  .converseFlow`'s `appendTurn`) and rendered (`MessageTurn.tsx`) verbatim. A non-empty caller
   *  `history` never triggered the fold in the first place (`seedHistory`'s `else` branch already
   *  appends the plain `message`), so `fullHistory` passes through unchanged. */
  private def desanitizeFirstTurn(fullHistory: Seq[ClaudeToolMessage], historyWasEmpty: Boolean, message: String): Seq[ClaudeToolMessage] =
    if (!historyWasEmpty || fullHistory.isEmpty) fullHistory
    else fullHistory.updated(0, ClaudeToolMessage.text(ClaudeRole.User, message))

  private def toolCallCount(history: Seq[ClaudeToolMessage]): Int =
    history.iterator.flatMap(_.content).count {
      case _: ClaudeContentBlock.ToolUse => true
      case _                              => false
    }
}
