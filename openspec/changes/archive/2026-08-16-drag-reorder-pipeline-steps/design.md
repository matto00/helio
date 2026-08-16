# Design: drag-reorder-pipeline-steps

## Context

Backend: `UpdatePipelineStepRequest(type, config, position: Option[Int])`
(`PipelineStepProtocol.scala:147`); `PipelineService.updateStep` (line ~524) passes `position`
straight to `pipelineStepRepo.updateInternal` — a raw value write, no sibling shifting, no
normalization, one HTTP request per step. `PipelineStepRoutes.scala` is a thin shell (all logic in
`PipelineService`); ACL pattern for step mutations = editor/owner via `requireEditorAccess`, with
NotFound masking for invisible pipelines. Steps are listed/executed ordered by `position`;
`PipelineService` reindexes `position = i` (0-based) on bulk creation (apply-proposal
`zipWithIndex`), but `deleteStep` does NOT renumber survivors — positions can have gaps today, so
nothing may assume contiguity; the reorder endpoint always reindexes 0..n-1 from scratch. `schemas/` +
`check:schemas` enforce JSON-schema ↔ JsonProtocols drift.
Frontend — **step-list ownership is `PipelineDetailPage`'s LOCAL state, not Redux**:
`useState<Step[]>` (line ~86) seeded from Redux exactly once (`stepsInitialized` gate, never
reset), then mutated only via direct `setSteps` + plain service calls — `handleAddStep`,
`handleInstantiateShape`, `handleRemoveStep` (fire-and-forget DELETE, tolerates local-only
`step-N` temp ids from failed POSTs), `handleStepConfigChange`. No step mutation goes through a
Redux thunk; `pushToast` is the page's failure-surfacing precedent. The UI `Step` type
(`types/step.ts`) has **no `position` field** — `pipelineStepToStep` (`stepNarrowing.ts`) drops it
at wire→UI conversion; list order alone is the rendering truth. `PipelineRiverView.tsx` renders
that list (steps.map with `RibbonSegment`s, index available). `PipelineDetailPage` re-dispatches
analyze via a 300ms-debounced, **order-sensitive** `stepsFingerprint` (array join of
`id:opType:config`); HEL-404 gave StepCard an effect-driven preview keyed on
`JSON.stringify(step.config)` while open. `frontend/package.json`
has no drag-and-drop library (react-grid-layout is panel-grid-specific, wrong tool for a vertical
list).

## Goals / Non-Goals

Goals: drag + keyboard reorder; atomic persistence surviving reload; analyze + open-preview refresh
after reorder; additive API only.
Non-goals: DAG/branching; new frontend dependencies; touching per-step PATCH semantics.

## Decisions

1. **Add the batch endpoint — per-step PATCH is insufficient for atomic reorder** (the ticket's
   pre-authorized branch, decided here on ground truth): a reorder of N steps needs up to N PATCH
   requests, each writing a raw position; there is no transaction across HTTP requests, so a
   mid-sequence failure (network, 5xx, session expiry) leaves duplicate/contradictory positions —
   i.e. a silently wrong *execution order* for a data pipeline, a correctness hazard rather than a
   recoverable UI glitch. New endpoint: `PUT /api/pipelines/:id/steps/order`, body
   `ReorderPipelineStepsRequest(stepIds: Seq[String])`, response = the full reordered step list
   (same shape as `GET .../steps`). Semantics: 404 unknown/invisible pipeline; 403 viewer; 422
   when `stepIds` is not exactly a permutation of the pipeline's current step ids (duplicates,
   unknown ids, or missing ids all fail — set equality + length); on success, one repository
   transaction sets `position = index` for every step, then returns the list. PUT (not POST):
   idempotent full replacement of the order resource.
2. **Repository**: new `PipelineStepRepository.reorderInternal(pipelineId, orderedIds)` running a
   single Slick `DBIO.sequence(...).transactionally` of position updates. Service does ACL +
   validation first (mirroring `updateStep`'s editor/owner + NotFound-masking pattern), repo does
   only the transactional write — matching the existing service/repo split. No migration:
   `position` column exists.
3. **Protocol + schema**: `ReorderPipelineStepsRequest` case class + `jsonFormat1` in
   `PipelineStepProtocol.scala`; new `schemas/reorder-pipeline-steps-request.schema.json` so
   `check:schemas` stays green. Additive only — no existing wire shape changes.
4. **Header DOM restructure — sibling controls, per the `SidebarItemList` precedent.** The
   entire StepCard header is currently ONE native `<button>` (`StepCard.tsx` ~231-252: icon +
   label + count + chevron, `onClick=handleHeaderClick`, `aria-expanded`). New interactive
   controls cannot nest inside it (invalid content model; clicks would bubble into the expand
   toggle). Restructure exactly as `frontend/src/shared/chrome/SidebarItemList.tsx`'s
   `renderRowAction` docstring prescribes ("a genuine sibling element, not nested inside the
   row's own `<button>` ... needs no `stopPropagation()`"): the header becomes a wrapper `<div
   className="...step-card-header">`, containing (a) the existing expand-toggle **`<button>`
   unchanged in content and semantics** (icon/label/count/chevron move inside it; it keeps
   `aria-expanded` + native keyboard activation for free, just no longer spans the whole header
   row), and (b) a sibling actions cluster: drag handle + Move up + Move down buttons. Header
   styling moves so the wrapper carries the row layout and the toggle button stretches
   (`flex: 1`); no behavioral change to expand/collapse. Honest sizing: this restructure + the
   actions cluster is ~30-40 lines in `StepCard.tsx` (not "buttons wiring" — see Planner Notes).
5. **Drag: native HTML5 DnD, no library, initiated from a dedicated drag handle.** A
   dnd-kit/react-dnd addition would be a new external dependency (human-escalation territory)
   for a linear list. Instead: the **drag handle element in StepCard's header actions cluster is
   the sole `draggable` element** (grip icon, `aria-hidden` drag surface with the keyboard path
   provided by the Move buttons). Cross-component wiring is by **props, not className coupling**:
   `PipelineRiverView` passes `onStepDragStart(index)` / `onStepDragEnd()` down to `StepCard`
   (which wires them to the handle's `onDragStart`/`onDragEnd`), and keeps `onDragOver`/`onDrop`
   on its own card-wrapper divs (drop targeting + `overIndex` state + drop-indicator line,
   token-only CSS). Body editors and the header toggle never initiate drags by construction —
   nothing needs `event.target.closest(...)` against another component's class names.
6. **Keyboard reorder: the Move up / Move down sibling buttons** (`aria-label="Move step
   up/down"`, disabled at the ends), invoking the same reorder handler with the adjacent
   transposition — direct, screen-reader-friendly, satisfies the AC's "by keyboard".
7. **State flow — page-local handler, NOT a Redux thunk** (follows the page's actual ownership
   pattern; every existing step mutation is local `setSteps` + a plain service call): new
   `handleReorderSteps(newOrder: Step[])` in `PipelineDetailPage`. (a) Snapshot the previous
   order; (b) `setSteps(newOrder)` optimistically — array order is the rendering truth, so the
   UI reorders immediately; (c) call the new plain service `reorderPipelineSteps(id,
   orderedIds)` where `orderedIds` = the **persisted** step ids in their new relative order,
   excluding local-only `step-N` temp ids (a temp id would fail the server's set-equality check;
   temp-id tolerance mirrors the existing PATCH/DELETE no-op convention); (d) on success,
   reconcile by mapping over the optimistic `newOrder`: replace each *persisted* entry with its
   corresponding `response` entry (looked up by id, converted via `pipelineStepToStep`), leaving
   any temp (`step-N`) entries untouched in place — never `setSteps(response.map(...))` wholesale,
   which would drop temp steps since the response contains only persisted steps; (e) on failure, `setSteps(previousOrder)` +
   `pushToast` error — an explicit revert, mirroring `handleInstantiateShape`'s
   never-silent-partial ethos (a fire-and-forget here would silently lose the order on reload).
8. **Analyze refresh — no new code; surfacing — generic `InlineError` in `StepCard`'s body
   (revised post-implementation, skeptic-final-1.md CR1/CR2)**: `stepsFingerprint` joins in
   array order, so both the optimistic reorder and the fulfilled replacement change the
   fingerprint → the existing 300ms debounce re-dispatches `analyzePipeline`, with zero
   additions — the *refresh* half is genuinely free. The *surfacing* half is not: at
   design-gate time this decision claimed newly-invalid steps would surface through an
   existing "validationError plumbing (badges/editors)" — no such badge mechanism exists
   anywhere in the codebase (only the unrelated run-status/schedule-status badges), and
   `validationError` was in fact rendered only by the `compute` op's editor
   (`ComputeFieldConfig`, pre-dating this ticket). Reordering is what newly exposes this gap
   broadly: it's the only way a picker-constrained step (whose config a user can normally only
   set to already-valid values) reaches an invalid state at all, for *any* op type, not just
   `compute`. Closed generically in `StepCard`'s expanded body: whenever `validationError` is
   present, render the already-shared `InlineError` component once, op-type-agnostically —
   for every op except `compute`, which keeps its own, more specific placement inline below
   its expression input (excluded from the generic render to avoid a double-render).
9. **Open-preview refresh — extend HEL-404's fingerprint with the step's LIST INDEX** (the UI
   `Step` type has no `position` field — see Context — and adding one would mean bookkeeping it
   through every local mutation): `PipelineRiverView` already maps with `idx` and must pass an
   index down anyway for Move-button disabled state and drag wiring, so StepCard gains a
   `stepIndex: number` prop and its preview fingerprint becomes
   `` `${stepIndex}:${JSON.stringify(step.config)}` ``. A reorder changes the index → open
   previews re-fetch through the same 500ms-debounced path; closed previews stay untouched.
   Accepted narrow race: the debounced preview GET can theoretically land before the reorder PUT
   commits (same shape as the existing analyze-after-local-change convention); the 500ms debounce
   covers one fast PUT round-trip in practice, and Decision 7(d)'s reconciliation makes the
   window one render at most.

## Planner Notes (self-approved)

- PUT full-order replacement over move-one-step semantics: one request, idempotent, no
  ambiguity about concurrent moves; matches the dashboard-layout batch-persist precedent.
- Optimistic reorder (Decision 6) accepted: reorder is high-frequency direct manipulation;
  snap-back UX is worse than the rare rejected-write refetch.
- `PipelineDetailPage.tsx` (583) / `StepCard.tsx` (434) remain past the 400-line budget
  (HEL-682 owns splits). Honest StepCard sizing: the header restructure + sibling actions
  cluster + drag-handle/Move-button wiring is ~30-40 lines (Decision 4), plus the one-line
  preview-fingerprint change (Decision 9) — StepCard will grow further past budget this change,
  accepted knowingly; the drop/drag orchestration and reorder computation land in
  `PipelineRiverView.tsx` (list owner) and the slice/service. Record actual growth in
  `files-modified.md` and carry into the PR description (with HEL-682 referenced for the split).
- Backend test surface: route-level tests in the existing `PipelineStepRoutesSpec.scala`
  (200 happy path, 404, 403 viewer, 422 non-permutation cases, persistence order check).

## Risks

- Native DnD quirks (drag image, dragover throttling) are cosmetic; the drop computation is
  index-based and testable without real drag events (unit-test the handlers directly).
- Concurrent edits (another editor adds a step mid-drag) → server-side set-equality check turns
  the stale reorder into a 422; frontend refetches and the user retries. Correct, explicit, rare.
