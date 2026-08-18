## Context

`ProposalHandoff.tsx` extracts the latest successful `propose_*` tool call from the assistant
transcript (`proposalExtraction.ts`) and, for `kind === "dashboard" | "patch"`, navigates to an
existing review route with `{state: {proposal|patchSet}}`. For `kind === "pipeline" | "combined"`
it falls through to an informational card (lines 75-83) — no route, no frontend type, exists for
either kind anywhere in the repo (verified by grep). The backend apply paths are live and unused
by the web app: `POST /api/pipelines/apply-proposal` (`PipelineProposalRoutes`, HEL-383) and
`POST /api/proposals/apply` (`CombinedProposalRoutes`, HEL-387). Two precedents already establish
the pattern this change mirrors: `ProposalReviewPage.tsx`/`ProposalReview.tsx` (dashboard) and
`PatchSetReviewPage.tsx`/`PatchSetReview.tsx` (patch), both: route container (state extraction +
DEV-only demo fixture + Accept/Reject thunks) wrapping a pure presentational component.

## Goals / Non-Goals

**Goals:**
- A pipeline proposal review page + a combined proposal review page, both reachable from
  `ProposalHandoff.tsx`, both wired to their live backend apply routes.
- Reuse the pipeline-proposal summary rendering unmodified inside the combined page (a
  `CombinedProposal` is exactly `{pipeline: PipelineProposal, dashboard: DashboardProposal}` —
  `CombinedProposalProtocol.scala` reuses both nested types verbatim, so the frontend does too).

**Non-Goals:**
- Wiring `GET /api/pipelines/:id/analyze` into either page (D2).
- Any backend change — both apply routes, and the `CreatePipelineStepRequest` wire shape the
  proposal's `steps` field reuses, are already correct and unmodified.
- Editing pipeline steps or the dashboard's panel list inline before accept on the **combined**
  page — its dashboard half is read-only (D8), unlike the standalone dashboard-only
  `/proposals/review` flow (`ProposalReview.tsx`), which keeps its own existing title-edit/panel-
  removal affordances untouched and unaffected by this change.

## Decisions

**D1 — Routes: `/pipeline-proposals/review` and `/combined-proposals/review`.**
`/proposals/review` is already the dashboard-proposal route (not "top-level proposal review" —
its own history is dashboard-specific), so combined cannot reuse it despite the backend's
`/api/proposals/apply` prefix naming. Kebab-case-noun-plus-`/review` matches the existing
`/patch-sets/review` convention more closely than nesting under `/pipelines/*` (which already
means "a persisted pipeline's own detail route," e.g. `/pipelines/:id`).

**D2 — No `analyze` preview wired in.** The proposal's own scope note says "consider surfacing" —
optional, and `GET /api/pipelines/:id/analyze` (`useAnalyzePipeline`, `PipelineDetailPage.tsx`)
takes a persisted pipeline `:id`. A `PipelineProposal` carries no ids — "nothing is created until
applied" is the proposal's own documented invariant (`PipelineProposalProtocol.scala` header
comment) — so there is no id to analyze before accept. Wiring this would require a new,
unplanned backend dry-run-against-an-unpersisted-proposal endpoint, out of scope here. Skipped;
noted as a natural follow-up once such an endpoint exists.

**D3 — New types/service live under `features/pipelines/` (proposal) and `features/proposals/`
(combined), not `features/dashboards/`.** Mirrors the backend's own placement:
`PipelineProposalProtocol`/`PipelineProposalRoutes` are pipeline-owned; `CombinedProposalProtocol`/
`CombinedProposalRoutes` sit in a package-neutral spot because a combined proposal is neither
exclusively a pipeline nor a dashboard concern (`CombinedProposalRoutes.scala` comment, "a
brand-new top-level `proposals` prefix... since it is neither exclusively"). `combinedProposal.ts`
imports `PipelineProposal` from `features/pipelines/types` and reuses `DashboardProposal` +
`AppliedProposal` from `features/dashboards/types/proposal.ts` verbatim (no new dashboard-half
type) — `DuplicateDashboardResponse` (`{dashboard, panels}`, `DashboardProtocol.scala`) is
byte-shape-identical to the frontend's existing `AppliedProposal`.

**D4 — `PipelineProposal.steps` typed loosely (`{type: string, config: Record<string,
unknown>, position?: number, enabled?: boolean}[]`), not the full per-kind `PipelineStepConfig`
discriminated union.** The review UI only needs to *display* each step's kind + a best-effort
summary of its config, never edit or validate it client-side (accept posts the untouched proposal
payload straight through) — matching the backend's own `CreatePipelineStepRequest(type, config:
JsObject, position, enabled)` looseness (`config` is an opaque `JsObject` server-side too,
validated only per-kind at apply time; `enabled` included in the frontend type for field-parity
with the backend request shape, even though a proposal is not expected to set it). A step kind the
frontend's `PipelineStepKind` union doesn't yet recognize (future op added on the backend first)
must still render, not crash — a loose type is the only one that guarantees that.
`PipelineProposalSummary` renders one row per step with `type` + `JSON.stringify(config)`
truncated, no per-kind switch.

**D5 — `PipelineProposalSource` mirrors the backend's flat-optional shape.** One TS interface
with `sourceId?`, `type?`, `name?`, `config?: Record<string, unknown>` — matching
`PipelineProposalSource`'s wire shape (`pipelineProposalSourceFormat`, one shared `"config"` key
regardless of kind). No frontend need to discriminate into 4 typed config shapes for a read-only
summary; render `type` + a flattened key/value list of `config`.

**D6 — Accept navigation.** Pipeline-only accept → `navigate(`/pipelines/${response.pipeline.id}`)`
(the created pipeline's own detail page — the natural next stop, unlike a dashboard-apply's
`navigate("/")`). Combined accept → `navigate("/")` (mirrors `ProposalReviewPage`'s dashboard-apply
navigation exactly, since the primary artifact a combined proposal produces, from the user's
perspective, is the dashboard).

**D7 — New `applyPipelineProposal` thunk added to the existing `pipelinesSlice.ts`** (not a new
slice) — mirrors `dashboardsSlice.applyProposal`'s shape/error-unwrap exactly; no new dashboard
state needed since the created pipeline is not cached client-side today (`PipelinesPage` refetches
on mount, same as `PipelineDetailPage`). Combined proposal's apply thunk lives in a new, real
`createSlice()` at `features/proposals/state/combinedProposalsSlice.ts` (owns its own
`applying`/`error` state, registered in `store.ts` as `combinedProposals` — mirrors
`patchSetsSlice`'s own registration) — **on success it must dispatch BOTH**
`dashboardUpserted(response.dashboard.dashboard)` **AND**
`setSelectedDashboardId(response.dashboard.dashboard.id)` (both already exported from
`dashboardsSlice.ts`). `dashboardUpserted` alone (`dashboardsSlice.ts:216-223`) only inserts/
replaces the dashboard in `state.items` — it never touches `state.selectedDashboardId`, unlike
`applyProposal.fulfilled` (lines 308-311), which explicitly does both so `PanelList.tsx` (the `/`
route, which reads `state.dashboards.selectedDashboardId`) actually shows the just-created
dashboard. `patchSetsSlice`'s own `dashboardUpserted` usage is not analogous here — it re-syncs an
already-selected dashboard's cache after an edit and never needs to newly select anything; a
brand-new dashboard from a combined-proposal accept does.

**D8 — Combined page's dashboard half is NEW, read-only JSX, not a reuse of `ProposalReview.tsx`
(skeptic round 1 REFUTE, fix required).** `ProposalReview.tsx` (216 lines) is one monolithic
component: it owns its own `<Modal>` chrome and its own Accept ("Accept & create")/Reject footer
wired directly to `onAccept`/`onReject`, with panel-list JSX interleaved with local `useState`
edit state (`updateTitle`, `removePanel`, `bindingIssue`) — there is no separable "just the panel
list" piece, and no prop to suppress its own chrome/footer. Dropping it into
`CombinedProposalReview` as originally planned would render a *second*, dashboard-scoped Accept/
Reject pair nested inside the combined page's own single footer, contradicting "a single Accept/
Reject pair covering both halves." Rather than refactor an already-shipped, independently-used
component to extract a footer-less sub-piece (an invasive change to a component this ticket does
not otherwise need to touch — CONTRIBUTING.md's "avoid unrelated refactors" guidance), write new,
dedicated, **read-only** JSX for the combined page's dashboard half (dashboard name + panel list:
title/type/bound-DataType-name/field-mapping, one row per panel, no title-edit or removal
affordances) — the same read-only-summary philosophy D4/D5 already apply to the pipeline half, and
the same one this design's Risk 2 already accepts for the whole review surface. `ProposalReview.tsx`
itself is untouched; the standalone `/proposals/review` dashboard-only flow keeps its existing
edit affordances unchanged.

## Risks / Trade-offs

- [Risk] A `combined` proposal's dashboard half references the pipeline's not-yet-created output
  via the `"$pipelineOutput"` sentinel (`CombinedProposalService`) — the review UI must not try to
  resolve/display that sentinel as a real DataType name (unlike `ProposalReview.tsx`'s existing
  `dataTypesById` binding-name lookup, which assumes real ids). → `CombinedProposalReview`'s nested
  dashboard-panel rendering special-cases the sentinel literal as "this pipeline's own output" text,
  never as a `dataTypesById` lookup miss/error.
- [Risk] Loosely-typed `steps`/`source.config` (D4/D5) means a malformed or unexpected proposal
  shape can silently render `undefined`/`[object Object]` rather than crash — acceptable since this
  is a read-only review surface for a machine-generated payload the backend re-validates in full at
  apply time; any real defect surfaces there as an accept-time error, not silently applied.

## Planner Notes

- Route paths (D1) and the loose `steps`/`source` typing (D4/D5) are both self-approved judgment
  calls with no existing single "obviously correct" precedent to copy verbatim — flagged here
  rather than escalated, since neither is a new external dependency, breaking API change, or scope
  expansion beyond the ticket's own stated surface.
