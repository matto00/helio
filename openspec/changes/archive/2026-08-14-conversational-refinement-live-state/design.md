## Context

HEL-343's sibling tickets already shipped the artifact (`PatchSet`, HEL-403), atomic apply
(`PatchSetApplyService`, HEL-406), and dry-diff preview (`PatchSetPreviewService`, HEL-408). HEL-341/397
shipped NL dashboard *authoring* (`DashboardAuthoringService` + `AuthoringChatDrawer` + the
`authoring_conversations` multi-turn store), which this ticket's own backend/frontend/persistence
closely mirror — but authoring always CREATES a new dashboard; refinement targets an EXISTING
dashboard/pipeline and must produce a `PatchSet`, not a `DashboardProposal`.

## Goals / Non-Goals

**Goals:**
- A backend endpoint that grounds Claude in a live dashboard/pipeline's CURRENT state and returns a
  `PatchSet` already proven valid (via `PatchSetPreviewService.preview`), never applying it.
- ONE shared conversation store for both authoring and refinement turns (AC4 — no parallel store).
- An in-app chat surface + two MCP tools reaching the same endpoint.

**Non-Goals:**
- SSE streaming for the new endpoint — `DashboardAuthoringService`'s streaming path is real
  complexity (chunked `AuthoringStreamEvent`s, partial-buffer repair). Scoping v1 to buffered-only
  keeps this already-large ticket tractable; retrofitting streaming later follows the exact
  precedent HEL-397 already set when it added streaming to authoring.
- An in-app trigger for pipeline refinement (see proposal Non-Goals) — no pipeline page has an
  equivalent "live view" to anchor a drawer to.
- Undo (HEL-413).

## Decisions

**D1 — Live-state grounding, per `target.kind`.** `dashboard`: `DashboardRepository.findById(id,
callerOpt)` (NOT `DashboardService`, which has no single-dashboard-by-id read — this is the exact
sharing-aware, ACL-checked collaborator `PatchSetApplyResolvers.resolveDashboardUpdate` and
`AutoLayoutService` already use for this identical need) + `PanelRepository.findAllByDashboardId(id,
Some(user), Page(0, Page.MaxLimit))` (its current panels, RLS-scoped, same repo HEL-408's
`existsBoundToType` lives in — `AutoLayoutService.scala:66`'s own "get effectively all panels"
precedent for the argument order/`Page`). `pipeline`: `PipelineService.findSummaryById` + `.listSteps`. Access tier: viewer-
sufficient — grounding never writes, and `apply` independently re-checks editor access at write time,
so requiring editor here would only block a legitimate "let me see what you'd propose" read. ALSO
grounds in workspace-wide context: `WorkspaceContextService.assemble` (HEL-345) + `PanelCapabilityService.
getCapabilities` (HEL-365) per pipeline-output DataType — the same two calls
`DashboardAuthoringService.assembleGroundedContext` already makes — so a refinement like "add a table of
top customers" (a `create` edit binding a DataType not yet used on the current dashboard) has something
to bind to, not just the dashboard's already-bound types. Assembled into a grounding block mirroring
`DashboardAuthoringPrompt.userMessage`'s shape, but ALSO carrying the target's real current panel/step
ids so the resulting `Edit.target.id`s resolve (AC5, `specs/conversational-refinement` "workspace and
capability grounding" requirement).

**D2 — Parse → validate reuses the preview path, not a new validator.** Claude's response text parses
via `PatchSetProtocol`'s existing hand-written `editFormat` reader (HEL-403, already
absent-optional-tolerant) — a parse failure (malformed/non-JSON output) is caught here, structurally
identical to `DashboardAuthoringParsing.parseProposal`'s own failure path, and triggers the SAME
repair round-trip as a `preview`-level rejection (D2a below), never surfaced as a different failure
class. "Validated" (AC1) means: before returning, the service runs the parsed `PatchSet` through
`PatchSetPreviewService.preview(patchSet, user)` (HEL-408) — the exact same pre-validation + per-kind
content checks `apply` itself would run. A `Left` triggers ONE repair round-trip (mirrors
`DashboardAuthoringService.runRepair`); a second failure returns `422`. This is the SAME "reuse the
apply path's own validation" pattern `DashboardAuthoringService` already uses via
`DashboardProposalService.validate` — zero new validation logic.

**D2a — Prompting strategy for `PatchSet`'s harder wire shape (the ticket's central technical bet).**
`PatchSet` has never been produced by an LLM anywhere in this codebase (confirmed against the archived
HEL-403 design.md — it was designed purely as an apply-path/wire contract) and its shape is materially
harder to describe unambiguously than `DashboardProposal`'s flat `jsonFormat2` shape: `Edit.patch`
(`PatchSetProtocol.editFormat`) is a discriminated union collapsed onto ONE shared `"patch"` wire key,
dispatched by the sibling `target.kind` into one of six `Update*Request` shapes, and a `panel` edit's
`UpdatePanelRequest.config`/`appearance` are themselves raw `JsValue` whose real shape depends on the
panel's *stored* kind. `RefinementPrompt` (task 2.3) MUST hand-maintain a shape description analogous to
`DashboardAuthoringPrompt.ProposalShapeDescription` — a worked JSON example for EACH `target.kind`
(panel/dashboard/dataSource/dataType/pipeline/pipelineStep), including one panel `config` example for
EVERY kind in `PanelBindingSpec.DataBindable` (metric/chart/table/collection/timeline — all five, not a
subset: `PanelCapabilityService.getCapabilities` already computes a capability entry for all five per
pipeline-output DataType, so the grounding itself will surface all five as bindable regardless of which
ones get a worked example — giving Claude examples for only 3 would leave it grounded-but-blind for the
other 2). Not an incidental prompt-copy task — load-bearing implementation work sized accordingly.

**D3 — One shared conversation store, two outcome columns, DB-enforced mutual exclusivity.**
`authoring_conversations` (V78 migration) gains a nullable `latest_patch_set JSONB` column alongside
the existing `latest_proposal`, PLUS `CHECK (latest_proposal IS NULL OR latest_patch_set IS NULL)` —
following this codebase's own established convention of a DB-level `CHECK` for exactly this class of
invariant (confirmed ~20 precedent migrations: `V23__pipeline_steps.sql`'s `op` enum,
`V62__pipeline_schedules.sql`'s `kind` enum, `V73__add_resource_tag.sql`'s length check). Application
discipline (whichever `*Turns` class writes a conversation populates only its own column) is still the
FIRST line of defense — the `CHECK` is the backstop against a future bug, ad hoc backfill, or manual
`UPDATE`, not a substitute for getting the application code right. `AuthoringConversationRecord`/`Row`
carry BOTH `Option[DashboardProposal]` and `Option[PatchSet]`. New `RefinementConversationTurns`
(sibling file to the existing `AuthoringConversationTurns`, same `AuthoringConversationRepository`)
provides `persistNew`/`persistContinuation` for the patch-set outcome — keeps both turn-glue classes
under CONTRIBUTING's ~250-line soft budget rather than growing one god class. `appendTurn`/`create` on
the repository take the now-dual-optional pair explicitly (never inferred), so a call site can never
silently populate both — and even if one somehow did, the `CHECK` rejects the write outright.

**D3a — Continuing a conversation SHALL reject the wrong flow's id, never silently reassign it.**
Today's `loadForContinuation` (`DashboardAuthoringService.scala:212+`) checks only existence/ownership —
safe today since only one flow exists, but once generalized, `appendTurn`'s existing unconditional
column overwrite (`AuthoringConversationRepository.scala:92-96`) would let a `conversationId` from the
OTHER flow load successfully (found, owned) and then silently reassign that row's outcome column
(destroying its prior value), satisfying D3's `CHECK` while corrupting data no error ever surfaces.
Each flow's continuation load MUST additionally require its OWN outcome column already be populated on
the loaded record (`RefinementService`: `latestPatchSet.isDefined`; `DashboardAuthoringService`,
symmetrically generalized: `latestProposal.isDefined`) — rejecting a cross-flow id the SAME "not found"
shape an owner mismatch already gets, never an overwrite.

**D4 — Reload-hydration reuses the existing GET route.** `GET /api/authoring/conversations/:id`
(HEL-397 design.md D7) already exists; generalize `AuthoringConversationView`/`findDisplayById` to also
carry `latestPatchSet: Option[PatchSet]`. `RefinementChatDrawer`'s reload-hydration (mirroring
`AuthoringChatDrawer.rehydrateFromStorage`) reuses this SAME route — no new endpoint needed for it.

**D5 — New route, buffered only.** `POST /api/refinements`: `{target: {kind, id}, message,
conversationId?}` → `PatchSet` (or an `AuthoringError`-shaped failure, reusing `AuthoringErrorKind` —
`InvalidProposal`/`ModelFailure`/`BudgetExceeded`/`EmptyWorkspace` all apply unchanged; a NEW kind
isn't needed). Mounted unconditionally like `DashboardAuthoringRoutes`, gated on the same
`ClaudeConfig`-derived `Option[RefinementService]` (`503` when absent).

**D6 — Frontend: a sibling drawer, not a modified one.** `RefinementChatDrawer` (new file, NOT an
edit to `AuthoringChatDrawer` — different target semantics: existing resource vs. new) is mounted in
`App.tsx` (which already tracks `selectedDashboardId`, unlike `DashboardList.tsx` where
`AuthoringChatDrawer` lives), takes `dashboardId` as a required prop, and on a successful turn
navigates to `/patch-sets/review` with `location.state.patchSet` — HEL-408's own
`PatchSetReviewPage.tsx` already reads exactly this shape for "a future caller," reused here
unmodified, mirroring `AuthoringChatDrawer.handleReviewAndApply` → `/proposals/review` exactly.

**D7 — MCP tools reuse existing HTTP calls, add no new backend surface.** `propose_patch_set` (new
`helio-mcp/src/tools/refinement.ts`) calls `POST /api/refinements` via a new `HelioApi.proposePatchSet`
method (mirrors `HelioApi.updatePanel`, HEL-627). `apply_patch_set` posts to the EXISTING
`/api/patch-sets/apply` (HEL-406) — no new backend route, just an MCP wrapper, mirroring
`apply_proposal`'s own relationship to `apply-proposal`.

## Risks / Trade-offs

- [Claude references a stale/wrong panel or step id from the grounding block] → `resolveAll` (inside
  `preview`) already rejects any edit targeting a nonexistent/inaccessible resource — the SAME
  guardrail `apply` has always had; a bad grounding reference surfaces as a normal repair-then-422,
  never a silent bad write (preview never writes).
- [Two nullable JSONB columns on one row looks like it invites an inconsistent both-populated state]
  → mitigated by construction (D3): only ONE of `RefinementConversationTurns`/`AuthoringConversationTurns`
  ever writes to a given conversation id, backstopped by a DB `CHECK` constraint (not just application
  discipline + a test) so an inconsistent row is structurally impossible, not merely untested.
- [A freshly-Claude-generated `PatchSet` is untrusted input `preview` wasn't built expecting from a
  trusted apply-review flow] → `preview`'s `resolveAll`/content checks validate regardless of caller
  trust level (verified against `PatchSetApplyResolvers`); unparseable output is caught earlier, at
  parse time (D2). The harder risk is D2a's prompt-shape problem, not `preview`'s robustness.

## Planner Notes

Capability split (proposal.md) mirrors the existing authoring split exactly:
`nl-dashboard-proposal-authoring`/`nl-authoring-chat-surface`/`authoring-conversation-state`/
`mcp-pipeline-proposal-tools` → `conversational-refinement`/`refinement-chat-surface`/
`authoring-conversation-state` (modified)/`mcp-patch-set-tools`. Self-approved: buffered-only (D5,
Non-Goal) and the dashboard-only in-app trigger (Non-Goal) as scope cuts to keep this ticket
deliverable in one cycle — both are additive gaps a follow-on ticket can close without touching this
one's shape.
