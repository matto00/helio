package com.helio.services.assistant

import com.helio.services.panels.PanelCapabilityService
import com.helio.services.patchsets.PatchSetPreviewService
import com.helio.services.pipelines.PipelineProposalService
import com.helio.services.proposals.{CombinedProposalService, DashboardProposalService}
import com.helio.services.sources.SourceService
import com.helio.services.workspace.WorkspaceSearchService
import com.helio.infrastructure.ai.{ClaudeClient, ClaudeContentBlock, ClaudeError, ClaudeModelSpec, ClaudeRole, ClaudeToolMessage, ClaudeToolOutcome, ClaudeToolRequest, TokenUsage}
import com.helio.api.protocols.assistant.{AssistantProposal, AssistantProtocol, AssistantTurnResult}
import com.helio.domain.model.AuthenticatedUser
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Success, Try}

/** HEL-662 — the top-level assistant's (HEL-659) one entry point, superseding
 *  `DashboardAuthoringService` for the in-app assistant while reusing its validation/proposal
 *  collaborators rather than discarding them. Builds the static system prompt + the bounded 7-tool
 *  set (HEL-756 adds `test_connection`), runs `ClaudeClient.sendWithTools` with a hop ceiling
 *  of 12 and a budget of 3 failed tool calls (HEL-1637), and folds the
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
    patchSetPreviewService: PatchSetPreviewService,
    sourceService: SourceService
)(implicit ec: ExecutionContext) {

  /** The configured Claude model id (HEL-667 design.md D6 telemetry) — thin passthrough so
   *  `AssistantConversationRoutes.converseFlow` can thread it into `AssistantTelemetry` without
   *  reaching into a `ClaudeClient` instance of its own. */
  def modelId: String = claudeClient.modelId

  /** HEL-665 (reopened composer ticket, design.md D1): `Future[Either[ClaudeError,
   *  AssistantTurnResult]]`, mirroring `ClaudeClient.send`'s own existing `Either` shape — the only
   *  way to represent `ClaudeToolOutcome.Failed` (which carries no `history` at all) without either
   *  silently discarding the user's message or fabricating a persisted "response" for a real API
   *  failure. */
  def converse(
      history: Seq[ClaudeToolMessage],
      message: String,
      user: AuthenticatedUser,
      model: Option[ClaudeModelSpec] = None
  ): Future[Either[ClaudeError, AssistantTurnResult]] = {
    val executor = new AssistantToolExecutor(
      workspaceSearchService,
      panelCapabilityService,
      dashboardProposalService,
      pipelineProposalService,
      combinedProposalService,
      patchSetPreviewService,
      sourceService,
      user
    )
    val request = ClaudeToolRequest(
      history = seedHistory(history, message),
      tools = AssistantProtocol.assistantTools,
      maxHops = AssistantStopMessages.HopCeiling,
      // HEL-1637 D2/D4: 3 failed tool calls end a turn; a mid-turn input-limit rejection keeps the work done so far.
      failureBudget = Some(AssistantStopMessages.failureBudget),
      stopOnInputBudget = true,
      // HEL-757 design.md D1 — every converse call offers Claude's server-side web_search tool,
      // unconditionally: never gated on message content/intent (the sole caller of sendWithTools
      // is this one call site, so "every assistant turn" resolves cleanly to "always true" here).
      webSearch = true,
      // HEL-1639 D5: a turn yields ONE proposal; only the first propose_* of a response runs.
      oncePerResponseTools = AssistantProtocol.proposeToolNames,
      // HEL-1718: the prompt rides the API `system` field on EVERY hop of EVERY turn, never inside a message.
      system = Some(AssistantSystemPrompt.text),
      // HEL-1755 D2: fixed for the whole loop; None = the server default (`ClaudeConfig.model`).
      model = model
    )
    // `history` (the CALLER-supplied prefix) is threaded through to `toTurnResult` to isolate this call's OWN
    // new turns (`fullHistory.drop(history.length)`) for `searchedWithNoResults` (HEL-667 design.md D2).
    claudeClient.sendWithTools(request, executor).map(outcome => toTurnResult(outcome, executor, history))
  }

  /** Appends the fresh user turn to `history`. The static [[AssistantSystemPrompt]] is NOT folded in here
   *  (HEL-1718): it travels in the API `system` field on every hop (see `converse`), so the turn is always the
   *  plain `message` and no persisted/rendered turn ever contains the prompt.
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
    val danglingIds = danglingToolUseIds(history)
    val newTurnContent: Seq[ClaudeContentBlock] =
      danglingIds.map(id => ClaudeContentBlock.ToolResult(id, DanglingToolUseResultMessage, isError = true)) :+
        ClaudeContentBlock.Text(message)
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
   *  `fullHistory` returned as-is (it never contains the system prompt, HEL-1718). `Failed` carries no `history` at all — folded to
   *  `Left(error)` directly, never a value-less or fabricated `AssistantTurnResult`. `history` here
   *  is `converse`'s own CALLER-supplied prefix, needed by [[computeSearchedWithNoResults]]
   *  (HEL-667 design.md D2). */
  private def toTurnResult(
      outcome: ClaudeToolOutcome,
      executor: AssistantToolExecutor,
      history: Seq[ClaudeToolMessage]
  ): Either[ClaudeError, AssistantTurnResult] = outcome match {
    // HEL-1636 D6: a final response with no visible text and no captured proposal is an error, never
    // a persisted empty answer. With a proposal the turn succeeds (propose_* then an empty end_turn
    // is the assistant's normal way to finish).
    case ClaudeToolOutcome.FinalResponse(text, _, _) if ClaudeContentBlock.isBlankText(text) && executor.proposal.isEmpty =>
      Left(ClaudeError.NoAnswer(Some("end_turn"), None))
    case r @ ClaudeToolOutcome.FinalResponse(text, fullHistory, usage) =>
      Right(
        AssistantTurnResult(
          text,
          executor.proposal,
          toolCallCount(fullHistory),
          hopBudgetExhausted = false,
          searchedWithNoResults = computeSearchedWithNoResults(executor.proposal, fullHistory, history),
          usage,
          persistable(fullHistory),
          proposeAttempts = executor.proposeAttempts,
          proposeDecodeFailures = executor.proposeDecodeFailures,
          proposeValidationFailures = executor.proposeValidationFailures,
          responseModel = r.responseModel,
          hopsUsed = r.hopsUsed,
          failedToolCalls = r.failedToolCalls
        )
      )
    case h @ ClaudeToolOutcome.HopBudgetExhausted(fullHistory, usage) =>
      // The history keeps its trailing assistant turn with unexecuted tool_use (see `seedHistory`).
      Right(stopResult("hop_ceiling", AssistantStopMessages.HopCeilingMessage, fullHistory, usage, executor, h.responseModel, h.hopsUsed, h.failedToolCalls))
    case f @ ClaudeToolOutcome.FailureBudgetExhausted(fullHistory, usage, failed) =>
      val message = AssistantStopMessages.failureBudgetMessage(failed, executor.proposal.isDefined)
      Right(stopResult("failure_budget", message, appendStopText(fullHistory, message), usage, executor, f.responseModel, f.hopsUsed, failed.size))
    case i @ ClaudeToolOutcome.InputBudgetExhausted(fullHistory, usage) =>
      val message = AssistantStopMessages.InputBudgetMessage
      Right(stopResult("input_budget", message, appendStopText(fullHistory, message), usage, executor, i.responseModel, i.hopsUsed, i.failedToolCalls))
    case ClaudeToolOutcome.Failed(error) =>
      Left(error)
  }

  /** HEL-1637 D5: the assistant stop-text turn that keeps a transcript ending in tool results alternating cleanly. */
  private def appendStopText(fullHistory: Seq[ClaudeToolMessage], message: String): Seq[ClaudeToolMessage] =
    fullHistory :+ ClaudeToolMessage(ClaudeRole.Assistant, Seq(ClaudeContentBlock.Text(message)))

  private def stopResult(
      stopReason: String,
      message: String,
      fullHistory: Seq[ClaudeToolMessage],
      usage: TokenUsage,
      executor: AssistantToolExecutor,
      responseModel: Option[String],
      hopsUsed: Int,
      failedToolCalls: Int
  ): AssistantTurnResult =
    AssistantTurnResult(
      message,
      executor.proposal,
      toolCallCount(fullHistory),
      hopBudgetExhausted = stopReason == "hop_ceiling",
      searchedWithNoResults = false,
      usage,
      persistable(fullHistory),
      proposeAttempts = executor.proposeAttempts,
      proposeDecodeFailures = executor.proposeDecodeFailures,
      proposeValidationFailures = executor.proposeValidationFailures,
      responseModel = responseModel,
      stopReason = stopReason,
      hopsUsed = hopsUsed,
      failedToolCalls = failedToolCalls,
      stopMessage = Some(message)
    )

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

  /** HEL-1636 D4: what `converse` returns for persistence. Thinking, redacted-thinking and unrecognised
   *  blocks are model-internal (their signatures are bound to a prefix that changes between turns,
   *  see HEL-1718) and empty text blocks are the very defect this ticket fixes; both are removed
   *  from EVERY turn. The number of turns is unchanged, because the route slices the result by the
   *  prior history length.
   *
   *  Dropping an `Opaque` block could orphan a future server-tool result paired with a kept
   *  `server_tool_use`; only `web_search` is offered and its result type is modelled, so no such
   *  pairing exists today. Revisit if another server tool is added. */
  private def persistable(fullHistory: Seq[ClaudeToolMessage]): Seq[ClaudeToolMessage] =
    fullHistory.map { m =>
      m.copy(content = m.content.filter {
        case _: ClaudeContentBlock.Thinking | _: ClaudeContentBlock.RedactedThinking | _: ClaudeContentBlock.Opaque => false
        case ClaudeContentBlock.Text(t)                                                                               => !ClaudeContentBlock.isBlankText(t)
        case _                                                                                                        => true
      })
    }

  private def toolCallCount(history: Seq[ClaudeToolMessage]): Int =
    history.iterator.flatMap(_.content).count {
      case _: ClaudeContentBlock.ToolUse => true
      case _                              => false
    }
}
