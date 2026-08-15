## Context

`ClaudeClient.sendWithTools(ClaudeToolRequest(history, tools, maxHops, ...), executor:
ClaudeToolExecutor): Future[ClaudeToolOutcome]` (HEL-660, merged) is the loop primitive;
`WorkspaceSearchService.find`/`getResource` + `WorkspaceAssistantTools.{findTool,getResourceTool}`
(HEL-661, merged, not yet wired into `ApiRoutes.scala` or any DI graph) are the search tools.
Neither has a caller yet. `DashboardProposalService.validate` already exists (non-mutating,
"structural + binding validation only — no side effects, nothing created either way");
`PipelineProposalService`/`CombinedProposalService` expose only a mutating `apply` — no equivalent.
`PatchSetPreviewService.preview` (HEL-408, merged) is already non-mutating.

No `assistant_conversations` table exists yet (HEL-663, a separately-filed, already-scoped ticket
in the established delivery order, not an ad hoc deferral). A directly analogous table **does**
already exist, though: `authoring_conversations` (V77, extended by V78 for a second conversation
kind — `DashboardAuthoringService`/`RefinementService` already share it). HEL-663's canonical design
(GCS-backed transcript body + slim Postgres metadata row) is a deliberately different physical shape
from `authoring_conversations`' full-JSONB-in-Postgres approach, so a third extension of that table
is not simply "free" — but that comparison belongs here, named, rather than implying no precedent
exists at all (design-gate round 1 fix).

`DashboardAuthoringService` grounds every proposal in a per-DataType `PanelCapabilitiesResponse`
(`PanelCapabilityService.getCapabilities`, bindable panel kinds + required/optional slots),
injected directly into its prompt with an explicit rule ("only use a panel kind marked bindable").
`WorkspaceContextDataType` (what `get_resource(type=dataType)` returns) carries columns/sample
rows/stats but no capability field — this grounding has no path into the new tool loop as
originally planned (design-gate round 1 finding, fixed by D3a below).

## Goals / Non-Goals

**Goals:**
- One `AssistantService.converse` entry point running the bounded 6-tool loop, `maxHops = 3`.
- Every `propose_*` path is provably non-mutating — the Hard Boundary this whole epic is built
  around.
- AC2's fallback (no matching DataType → `propose_pipeline`/`propose_combined`) is pure emergent
  behavior from the system prompt + tool availability — zero special-case branching in
  `AssistantService` itself.

**Non-Goals:**
- No conversation persistence (HEL-663) — `converse` takes an explicit history parameter.
- No live streaming route, no DI/route wiring, no frontend changes — mirrors HEL-661's own
  zero-route precedent.
- No retirement of `DashboardAuthoringService`/`AuthoringChatDrawer` (HEL-666).

## Decisions

**D1 — `converse(history: Seq[ClaudeToolMessage], message: String, user: AuthenticatedUser):
Future[AssistantTurnResult]`, not `converse(conversationId, message)`.** The ticket's literal text
names `conversationId`, but no
persistence exists yet to look one up from (HEL-663 is a later ticket in the established delivery
order). Self-approved scope narrowing, directly precedented by this same ticket's own "ship without
[HEL-406] initially... add it once it lands" language, applied here to the one dependency that
turned out not to be ready instead. `history` is caller-supplied so HEL-663 can add a real
Postgres/GCS-backed loading step in front of this unchanged, exactly as `propose_patch_set` slots
into the now-already-shipped HEL-406 without reshaping the loop.

**D2 — Tool set and cap.** `AssistantProtocol.assistantTools: Vector[ClaudeTool] =
Vector(WorkspaceAssistantTools.findTool, WorkspaceAssistantTools.getResourceTool,
proposeDashboardTool, proposePipelineTool, proposeCombinedTool, proposePatchSetTool)`. `maxHops =
3` — HEL-660's `ClaudeToolRequest.maxHops` finally gets its concrete caller-supplied value, exactly
as HEL-660's own doc comment says this ticket would.

**D3 — `PipelineProposalService.validate`/`CombinedProposalService.validate`: new, non-mutating,
required by the Hard Boundary.** `PipelineProposalService.validate(proposal, user):
Future[Either[ServiceError, Unit]]` runs the existing (widened from `private` to `private[services]`)
`validateStructure` check, plus — for a source reference to an *existing* `sourceId` only — a
read-only `dataSourceRepo.findByIdOwned` existence/ownership check (mirrors
`DashboardProposalService.validate`'s own "binding validation against real ids"). An *inline* source
spec (kind=csv/rest/static, no pre-existing id) gets structural validation only — resolving/creating
it is exactly what `apply`'s `resolveSource` does, and a non-mutating validate cannot do that without
violating the Hard Boundary itself; this asymmetry is accepted, not a defect (see Risks).
`CombinedProposalService.validate(combined, user)` delegates the pipeline portion to
`pipelineProposalService.validate`, reuses its own existing private `validateOutputRefPositions` for
the dashboard portion's sentinel-position structure, **and** (design-gate round 1 fix — the original
draft skipped this too) mirrors `DashboardProposalService.validateStructure`'s exact two checks:
`combined.dashboard.dashboardName.trim.isEmpty` (design-gate round 2 fix — round 1's fix added only
the second of these two checks, not both) plus `ProposalPanelSupport.validatePanel` (already public,
pure, in-memory — panel-type validity, non-blank title, chart/divider/timeline field validity,
aggregation conflicts) per dashboard panel. It deliberately does **not** attempt the one piece that
genuinely can't run yet: `preValidateBindings`'s DB-backed resolution of the real `dataTypeId`, since
panels reference the `"$pipelineOutput"` sentinel, not a real id, until the pipeline is actually
applied (mirrors `apply`'s own real sequencing). Only the DB-backed binding check is deferred — every
pure structural check `propose_dashboard` would have caught (blank dashboard name, blank panel title,
invalid chart type, aggregation conflicts) is caught here too, so `propose_combined` doesn't get a
weaker self-correction loop than `propose_dashboard` for the checks that don't require the sentinel
to already be resolved.

**D3a — Panel-capability grounding reaches Claude via `get_resource`'s tool_result payload, not the
static system prompt (design-gate round 1 fix — a real AC1 parity gap in the original draft).**
`AssistantSystemPrompt` is static text; it structurally cannot carry a per-DataType capability menu
the way `DashboardAuthoringPrompt`'s dynamically-built prompt does today. Instead:
`AssistantToolExecutor`'s `get_resource` dispatch, specifically when `resourceType == DataType`,
additionally calls `panelCapabilityService.getCapabilities(dataTypeId, user)` (already exists, same
service `DashboardAuthoringService` already depends on) and includes its `PanelCapabilitiesResponse`
in the JSON tool_result payload as a **distinct, nested top-level key alongside** (not flat-unioned
with) the existing `WorkspaceResourceDetail` — concretely `{"detail": <WorkspaceResourceDetail JSON>,
"panelCapabilities": <PanelCapabilitiesResponse JSON>}` (design-gate round 2 fix: both wire shapes
use the literal key `"columns"` for materially different content —
`WorkspaceContextDataType.columns: Vector[WorkspaceContextColumn]` carries `semanticRole`;
`PanelCapabilitiesResponse.columns: Vector[PanelCapabilityColumnResponse]` does not — a flat
`JsObject(detailFields ++ capsFields)` merge would silently drop one `columns` array via `Map ++`
right-wins semantics; nesting under distinct keys avoids the collision entirely). Claude sees both
the column/sample data and the bindable-panel-kind menu from one `get_resource` call, delivered
through the tool-result channel instead of prompt injection. `AssistantSystemPrompt` carries the
*rule* ("only propose a panel kind a fetched DataType's capability menu marks bindable") as static
guidance; the *data* the rule operates on arrives per-call via the tool result, exactly mirroring
how `DashboardAuthoringPrompt` already separates its own static rule text from the per-DataType data
it's applied to.

**D4 — `propose_patch_set` needs no new service method.** `PatchSetPreviewService.preview(patchSet,
user)` (HEL-408) is already public and non-mutating — the executor calls it directly.

**D5 — Tool-input parsing needs no repair-prompt reuse.** Unlike `DashboardAuthoringParsing`'s
free-text-JSON repair loop (built for when Claude's raw text response has to be coerced into JSON),
a `tool_use` block's `input` arrives as a already-structured `JsValue` per Claude's own function-
calling contract — `.convertTo[DashboardProposal]` (etc., reusing each type's existing spray-json
formatter) either succeeds or throws `DeserializationException`, caught and turned into a `Left`
message fed back as an `isError` `tool_result` (HEL-660 D7) so Claude can self-correct within the
remaining hop budget — a strictly simpler mechanism than the old repair-prompt path, not a
reimplementation of it.

**D6 — Structured proposal is captured via a one-shot, per-call side channel, not parsed from
Claude's final text.** `ClaudeToolOutcome.FinalResponse` only carries flat `text: String` — the
frontend's eventual Proposal Review UI needs the actual structured `DashboardProposal`/
`PipelineProposal`/`CombinedProposal`/`PatchSet` object, never re-derived from prose.
`AssistantToolExecutor` is constructed **fresh per `converse` call** (never shared/reused across
turns — no cross-request state leakage) and holds a private `AtomicReference[Option[AssistantProposal]]`,
overwritten only on a `propose_*` call's validation **success** (never on failure/`isError`, so a
later successful retry after an earlier rejected attempt correctly wins, and a rejected-then-
abandoned attempt never lingers). `AssistantService.converse` reads it once after `sendWithTools`
returns and folds it into `AssistantTurnResult.proposal: Option[AssistantProposal]`.

**Same-hop concurrency (design-gate round 1 fix).** `sendWithTools` executes every `tool_use` block
within one hop concurrently (`Future.traverse`), so "later wins" is only well-defined *across* hops
(sequential by construction), not *within* one — two concurrent `propose_*` successes in the same
hop would race on the `AtomicReference`. Closed two ways, not one: (1) `AssistantSystemPrompt`
explicitly instructs "call at most one `propose_*` tool per turn" (task 3.2) — the expected case
never exercises the race; (2) for the discouraged-but-not-architecturally-prevented case where a
model still emits two `propose_*` calls in one hop, the behavior is explicitly documented as
"some one of the successful calls' proposals wins, non-deterministically" — harmless, since every
`propose_*` output is validate/preview-only and still routes through the human-reviewed Proposal
Review UI regardless of which one is captured; a test asserts *some* proposal is captured (not a
specific winner) for this case, rather than leaving it as unspecified/untested behavior.

**D7 — `AssistantStreamEvent` (protocol-only, `AssistantProtocol.scala`), no live route.** Mirrors
`AuthoringStreamEvent`'s shape (`ToolCallStarted(name, hop)`, `ToolCallFinished(name, hop,
succeeded)`, `Result(text, proposal: Option[AssistantProposal], usage)`, `Error(message)`) so a
later streaming route has a concrete target — satisfies the ticket's "needs new event types" line
without building the route/DI wiring no AC requires (mirrors HEL-661's `WorkspaceSearchService`
shipping fully tested with zero `ApiRoutes.scala` wiring).

**D8 — No DI/route wiring in `ApiRoutes.scala` this ticket.** Same reasoning as D7 — no AC requires
a live endpoint; `AssistantService` is a fully real, fully tested, constructible class, ready for
whichever later ticket (664+) adds the actual `/api/assistant/converse`-shaped route.

## Risks / Trade-offs

- **`PipelineProposalService.validate`'s inline-source asymmetry (D3)** — an inline source's own
  structural shape is checked, but its actual resolvability (e.g. a CSV URL that 404s) isn't caught
  until real `apply` time → acceptable: catching it earlier would require the validate path to
  perform network/DB creation work, which is itself a mutation the Hard Boundary forbids; the
  existing Proposal Review UI is precisely the human checkpoint this risk is deferred to, same as
  today.
- **Structured-proposal side channel (D6) is mutable state on an otherwise-pure executor** → scoped
  tightly: one `AssistantToolExecutor` instance per `converse` call, discarded after use, never
  shared across concurrent requests — no different in shape from `DashboardAuthoringService`'s own
  per-call `AuthoringConversationTurns` helper (item 1 of planning research).
- **No DI wiring (D8) means `AssistantService` has zero live consumer this ticket** → identical,
  already-accepted trade-off to HEL-661's `WorkspaceSearchService`; a fully tested, unwired service
  is a normal intermediate state in this epic's staged delivery order, not a defect.

## Planner Notes

- Self-approved: `converse`'s history-parameter signature (D1) departs from the ticket's literal
  `conversationId` wording — narrowly scoped, directly precedented by the ticket's own HEL-406
  hedge, and stated prominently here plus in the PR description rather than silently substituted.
- Self-approved: adding `validate` to `PipelineProposalService`/`CombinedProposalService` (D3) —
  required by the ticket's own explicit Hard Boundary; the alternative (calling `apply` from a
  `propose_*` tool) would violate the one invariant this ticket calls out as non-negotiable.
