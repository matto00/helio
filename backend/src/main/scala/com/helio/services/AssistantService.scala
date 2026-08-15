package com.helio.services

import com.helio.ai.{ClaudeClient, ClaudeContentBlock, ClaudeError, ClaudeRole, ClaudeToolMessage, ClaudeToolOutcome, ClaudeToolRequest, TokenUsage}
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

  def converse(history: Seq[ClaudeToolMessage], message: String, user: AuthenticatedUser): Future[AssistantTurnResult] = {
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
    claudeClient.sendWithTools(request, executor).map(outcome => toTurnResult(outcome, executor))
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

  private def toTurnResult(outcome: ClaudeToolOutcome, executor: AssistantToolExecutor): AssistantTurnResult = outcome match {
    case ClaudeToolOutcome.FinalResponse(text, fullHistory, usage) =>
      AssistantTurnResult(text, executor.proposal, toolCallCount(fullHistory), hopBudgetExhausted = false, usage)
    case ClaudeToolOutcome.HopBudgetExhausted(fullHistory, usage) =>
      AssistantTurnResult(
        s"Reached the maximum number of tool calls ($MaxHops) without a final response.",
        executor.proposal,
        toolCallCount(fullHistory),
        hopBudgetExhausted = true,
        usage
      )
    case ClaudeToolOutcome.Failed(error) =>
      AssistantTurnResult(s"Assistant request failed: ${describeError(error)}", None, 0, hopBudgetExhausted = false, TokenUsage(0, 0))
  }

  private def toolCallCount(history: Seq[ClaudeToolMessage]): Int =
    history.iterator.flatMap(_.content).count {
      case _: ClaudeContentBlock.ToolUse => true
      case _                              => false
    }

  private def describeError(error: ClaudeError): String = error match {
    case ClaudeError.ApiError(status, body)    => s"API error ($status): $body"
    case ClaudeError.TransportFailure(message) => message
    case ClaudeError.GuardrailExceeded(reason) => reason
  }
}
