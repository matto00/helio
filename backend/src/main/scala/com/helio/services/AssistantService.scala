package com.helio.services

import com.helio.ai.{ClaudeClient, ClaudeContentBlock, ClaudeError, ClaudeRole, ClaudeToolMessage, ClaudeToolOutcome, ClaudeToolRequest}
import com.helio.api.protocols.{AssistantProposal, AssistantProtocol, AssistantTurnResult}
import com.helio.domain.AuthenticatedUser
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Success, Try}

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

  /** The configured Claude model id (HEL-667 design.md D6 telemetry) — thin passthrough so
   *  `AssistantConversationRoutes.converseFlow` can thread it into `AssistantTelemetry` without
   *  reaching into a `ClaudeClient` instance of its own. */
  def modelId: String = claudeClient.modelId

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
    // `history` (the CALLER-supplied prefix, before `seedHistory` folds AssistantSystemPrompt.text
    // into it) is threaded through to `toTurnResult` for two purposes: desanitizing the RETURNED
    // `fullHistory` back down to the plain `message` (evaluation-1.md Change Request 1), and — HEL-
    // 667 design.md D2 — isolating this call's OWN new turns (`fullHistory.drop(history.length)`)
    // for `searchedWithNoResults`'s "last tool call in THIS turn's new history" definition. `request`
    // above (what's actually sent to Claude) is completely unaffected either way.
    claudeClient.sendWithTools(request, executor).map(outcome => toTurnResult(outcome, executor, history, message))
  }

  /** Folds the static [[AssistantSystemPrompt]] into the SAME message as the fresh user turn, only
   *  when `history` is empty — mirrors `DashboardAuthoringPrompt`'s own precedent for the identical
   *  constraint (no separate `system` field on `ClaudeToolRequest`; Anthropic's Messages API also
   *  requires strict user/assistant alternation, so this can never be a second, separately-appended
   *  `user` turn). A non-empty `history` is a continued conversation (HEL-663) whose turn 1 already
   *  carried this text — never re-injected.
   *
   *  skeptic-final-1.md CR1 (live-verified defect): `history`'s LAST turn can be an assistant turn
   *  with one or more UNRESOLVED `tool_use` blocks — exactly the shape a persisted
   *  `ClaudeToolOutcome.HopBudgetExhausted` turn has (the loop stopped before dispatching them).
   *  Naively appending a bare text user turn directly after that violates the Messages API's
   *  invariant that a `tool_use` must be immediately followed by a `tool_result` in the VERY NEXT
   *  message — every subsequent `converse` call against that conversation failed identically with a
   *  400. [[danglingToolUseIds]] detects this; when present, the synthetic `isError` `tool_result`s
   *  (mirroring `ClaudeClient.executeTool`'s own recovery idiom, just applied to a NEVER-ATTEMPTED
   *  call rather than a failed one) are folded into the SAME new turn as the user's message —
   *  never a separate turn — so two consecutive `role = user` turns (which would violate the OTHER
   *  structural invariant, strict alternation) are never produced either. */
  private def seedHistory(history: Seq[ClaudeToolMessage], message: String): Seq[ClaudeToolMessage] = {
    val turnText  = if (history.isEmpty) AssistantSystemPrompt.text + "\n\n" + message else message
    val danglingIds = danglingToolUseIds(history)
    val newTurnContent: Seq[ClaudeContentBlock] =
      danglingIds.map(id => ClaudeContentBlock.ToolResult(id, DanglingToolUseResultMessage, isError = true)) :+
        ClaudeContentBlock.Text(turnText)
    history :+ ClaudeToolMessage(ClaudeRole.User, newTurnContent)
  }

  /** `tool_use` ids in `history`'s LAST turn with no paired `tool_result` — by construction, this
   *  can only ever be a non-empty result when that last turn is itself an assistant turn carrying
   *  `tool_use` blocks the loop never got to execute (a `FinalResponse` outcome's trailing turn is
   *  always text-only; a normally-executed hop's `tool_use` is always immediately followed by its
   *  own `tool_result` turn, which would then BE the last turn instead). Empty `Seq` (never `Set`)
   *  to preserve original ordering deterministically in the synthetic turn built above. */
  private def danglingToolUseIds(history: Seq[ClaudeToolMessage]): Seq[String] =
    history.lastOption.toSeq.flatMap(_.content).collect { case tu: ClaudeContentBlock.ToolUse => tu.id }

  private val DanglingToolUseResultMessage: String =
    "Not executed — the tool-call budget was reached before this call could run."

  /** `FinalResponse`/`HopBudgetExhausted` both carry a real `history` — folded to `Right(...)`,
   *  `fullHistory` desanitized via [[desanitizeFirstTurn]] before being returned (design.md D1 +
   *  evaluation-1.md Change Request 1). `Failed` carries no `history` at all — folded to
   *  `Left(error)` directly, never a value-less or fabricated `AssistantTurnResult`. `history` here
   *  is `converse`'s own CALLER-supplied prefix (before `seedHistory` folded it), needed both by
   *  [[desanitizeFirstTurn]] and by [[computeSearchedWithNoResults]] (HEL-667 design.md D2). */
  private def toTurnResult(
      outcome: ClaudeToolOutcome,
      executor: AssistantToolExecutor,
      history: Seq[ClaudeToolMessage],
      message: String
  ): Either[ClaudeError, AssistantTurnResult] = outcome match {
    case ClaudeToolOutcome.FinalResponse(text, fullHistory, usage) =>
      Right(
        AssistantTurnResult(
          text,
          executor.proposal,
          toolCallCount(fullHistory),
          hopBudgetExhausted = false,
          searchedWithNoResults = computeSearchedWithNoResults(executor.proposal, fullHistory, history),
          usage,
          desanitizeFirstTurn(fullHistory, history.isEmpty, message),
          proposeAttempts = executor.proposeAttempts,
          proposeDecodeFailures = executor.proposeDecodeFailures,
          proposeValidationFailures = executor.proposeValidationFailures
        )
      )
    case ClaudeToolOutcome.HopBudgetExhausted(fullHistory, usage) =>
      Right(
        AssistantTurnResult(
          s"Reached the maximum number of tool calls ($MaxHops) without a final response.",
          executor.proposal,
          toolCallCount(fullHistory),
          hopBudgetExhausted = true,
          searchedWithNoResults = false,
          usage,
          desanitizeFirstTurn(fullHistory, history.isEmpty, message),
          proposeAttempts = executor.proposeAttempts,
          proposeDecodeFailures = executor.proposeDecodeFailures,
          proposeValidationFailures = executor.proposeValidationFailures
        )
      )
    case ClaudeToolOutcome.Failed(error) =>
      Left(error)
  }

  /** HEL-667 design.md D2: `true` iff this turn captured no `proposal` AND the LAST tool call
   *  executed in this turn's OWN new history (`fullHistory` minus the caller-supplied `history`
   *  prefix — the seeded user turn plus every hop this `converse` call itself produced) was `find`
   *  returning an empty result array. Matches by `ToolUse.id`/`ToolResult.toolUseId` across every
   *  new turn rather than assuming a single hop: `Future.traverse`'s same-hop concurrency preserves
   *  input order (design.md "Same-hop concurrency"), but id-based lookup is correct regardless. */
  private def computeSearchedWithNoResults(
      proposal: Option[AssistantProposal],
      fullHistory: Seq[ClaudeToolMessage],
      callerHistory: Seq[ClaudeToolMessage]
  ): Boolean =
    if (proposal.isDefined) false
    else {
      val newTurns = fullHistory.drop(callerHistory.length)
      val toolUses = newTurns.iterator.flatMap(_.content).collect { case tu: ClaudeContentBlock.ToolUse => tu }.toVector
      val resultsById = newTurns.iterator
        .flatMap(_.content)
        .collect { case tr: ClaudeContentBlock.ToolResult => tr }
        .map(tr => tr.toolUseId -> tr)
        .toMap
      toolUses.lastOption.exists { lastCall =>
        lastCall.name == "find" && resultsById.get(lastCall.id).exists(tr => !tr.isError && isEmptyJsonArray(tr.content))
      }
    }

  /** `find`'s `ToolResult.content` is `Vector[WorkspaceResourceSummary].toJson.compactPrint`
   *  (`AssistantToolExecutor.executeFind`) — parses defensively rather than a literal `"[]"` string
   *  comparison, so incidental whitespace never produces a false negative. */
  private def isEmptyJsonArray(content: String): Boolean =
    Try(content.parseJson) match {
      case Success(JsArray(elements)) => elements.isEmpty
      case _                            => false
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
