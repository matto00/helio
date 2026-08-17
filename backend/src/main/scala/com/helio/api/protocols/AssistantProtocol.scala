package com.helio.api.protocols

import com.helio.ai.{ClaudeTool, ClaudeToolMessage, TokenUsage}
import com.helio.services.WorkspaceAssistantTools

// ── Top-level assistant conversation-loop types (HEL-662) ───────────────────
//
// `AssistantService.converse`'s result shape (`AssistantTurnResult`), the closed union over what a
// successful `propose_*` tool call can produce (`AssistantProposal`), and the streaming event shape
// a later ticket's route can target (`AssistantStreamEvent`, design.md D7 — protocol type only, no
// producer/route this ticket). The `propose_*` ClaudeTool schema definitions themselves live in
// `AssistantProposalToolSchemas.scala` (same package) — split out purely to keep each file inside
// CONTRIBUTING's file-size soft budget; `AssistantProtocol.assistantTools` (below) is still the one
// call site an `AssistantService` needs.

/** `AssistantService.converse`'s buffered result (HEL-662 tasks.md 2.1; `fullHistory` added by
 *  HEL-665's reopened composer ticket, design.md D1; `searchedWithNoResults` added by HEL-667
 *  design.md D2). `proposal` is the actual structured `DashboardProposal`/`PipelineProposal`/
 *  `CombinedProposal`/`PatchSet` a successful `propose_*` tool call produced during the turn —
 *  captured via `AssistantToolExecutor`'s one-shot side channel (design.md D6), never re-derived
 *  from `text`. `toolCallCount` counts every `tool_use` block actually executed across the whole
 *  turn (every hop); `hopBudgetExhausted` is `true` only for a `ClaudeToolOutcome.HopBudgetExhausted`
 *  outcome — the hard 3-hop cap was reached before a final text-only response. `searchedWithNoResults`
 *  is `true` iff the outcome is `FinalResponse` with no captured `proposal` AND the LAST tool call
 *  executed in this turn's NEW history (this call's own contribution to `fullHistory`, not the
 *  caller-supplied prefix) was `find` returning an empty result array — `false` for a hop-budget-
 *  exhausted outcome, a captured proposal, a non-empty `find`, or a turn with no `find` call at all
 *  (HEL-667 design.md D2). `fullHistory` is the caller-supplied history plus every new turn this
 *  call produced (the user's message, any `tool_use`/`tool_result` blocks, Claude's final response)
 *  — copied verbatim from `ClaudeToolOutcome.FinalResponse`/`HopBudgetExhausted`'s own `history`
 *  field so a caller (`AssistantConversationRoutes`, HEL-665) can persist the conversation's
 *  continuation without re-deriving it. Only ever constructed for a `Right` result — see
 *  `AssistantService.converse`'s `Future[Either[ClaudeError, AssistantTurnResult]]` signature; a
 *  `ClaudeToolOutcome.Failed` never produces one.
 *
 *  `proposeAttempts`/`proposeDecodeFailures`/`proposeValidationFailures` (HEL-700 design.md D5): flat
 *  `Int` passthroughs of `AssistantToolExecutor`'s own same-named counters, copied here at the SAME
 *  point `proposal`/`toolCallCount` are (this class is backend-internal — never serialized to the
 *  wire, see `AssistantProtocol.scala`'s own header comment) so `AssistantConversationRoutes
 *  .converseFlow` can thread them into `AssistantTelemetry.emitToolLoopOutcome` without reaching into
 *  an `AssistantToolExecutor` instance of its own. */
final case class AssistantTurnResult(
    text: String,
    proposal: Option[AssistantProposal],
    toolCallCount: Int,
    hopBudgetExhausted: Boolean,
    searchedWithNoResults: Boolean,
    usage: TokenUsage,
    fullHistory: Seq[ClaudeToolMessage],
    proposeAttempts: Int,
    proposeDecodeFailures: Int,
    proposeValidationFailures: Int
)

/** Closed union over what a successful `propose_*` tool call can produce (HEL-662 tasks.md 2.2) —
 *  wraps each underlying proposal type verbatim, never re-modeled. `Patch` additionally carries the
 *  `PatchSetPreviewResponse` `PatchSetPreviewService.preview` returned alongside the `PatchSet`
 *  itself, since (unlike the other three, whose `validate` returns bare `Unit`) `preview` produces a
 *  real diff/impact payload distinct from the input. */
sealed trait AssistantProposal

object AssistantProposal {
  final case class Dashboard(proposal: DashboardProposal) extends AssistantProposal
  final case class Pipeline(proposal: PipelineProposal) extends AssistantProposal
  final case class Combined(proposal: CombinedProposal) extends AssistantProposal
  final case class Patch(patchSet: PatchSet, preview: PatchSetPreviewResponse) extends AssistantProposal
}

/** Streaming event shape for a future `converse` route (HEL-662 tasks.md 2.3, design.md D7) —
 *  mirrors `AuthoringStreamEvent`'s kinds, generalized past a single `DashboardProposal` result.
 *  Protocol type only: no producer, no route, no SSE wiring in this ticket (mirrors HEL-661's own
 *  `WorkspaceSearchService` zero-route precedent).
 *
 *  `TurnResult`/`StreamError` (not the bare `Result`/`Error` tasks.md's prose names) —
 *  `scripts/check-schema-drift.mjs` enforces GLOBAL case-class-name uniqueness across every file in
 *  `api/protocols/`, and `AuthoringStreamEvent` (same package) already owns both `Result` and
 *  `Error`; same shape/fields either way, this ticket's naming just avoids the collision. */
sealed trait AssistantStreamEvent

object AssistantStreamEvent {
  final case class ToolCallStarted(name: String, hop: Int) extends AssistantStreamEvent
  final case class ToolCallFinished(name: String, hop: Int, succeeded: Boolean) extends AssistantStreamEvent
  final case class TurnResult(text: String, proposal: Option[AssistantProposal], usage: TokenUsage) extends AssistantStreamEvent
  final case class StreamError(message: String) extends AssistantStreamEvent
}

/** The bounded tool set `AssistantService.converse` hands to `ClaudeClient.sendWithTools` (HEL-662
 *  tasks.md 2.5, design.md D2) — `find`/`get_resource` reused VERBATIM from HEL-661's
 *  `WorkspaceAssistantTools`, plus the 4 `propose_*` schemas from `AssistantProposalToolSchemas`.
 *  This is the Hard Boundary's enforcement point: no apply-shaped tool is ever a member of this
 *  list (task 6.8 asserts exactly that), so Claude structurally cannot request a mutation — there is
 *  no tool schema through which one could even be requested. */
object AssistantProtocol extends AssistantProposalToolSchemas {

  val assistantTools: Vector[ClaudeTool] = Vector(
    WorkspaceAssistantTools.findTool,
    WorkspaceAssistantTools.getResourceTool,
    proposeDashboardTool,
    proposePipelineTool,
    proposeCombinedTool,
    proposePatchSetTool
  )
}
