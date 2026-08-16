# Files modified — drag-reorder-pipeline-steps (HEL-407)

## Backend

- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — added `ReorderPipelineStepsRequest(stepIds: Seq[String])` case class + `jsonFormat1` implicit (design Decision 3).
- `backend/src/main/scala/com/helio/api/package.scala` — exported `ReorderPipelineStepsRequest` type/companion alongside its siblings.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — added `reorderInternal(pipelineId, orderedIds)`: single transactional DBIO setting `position = index` per id, then re-reads the pipeline's steps in the new order (design Decision 2).
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — added `reorderSteps(pipelineId, req, user)`: mirrors `updateStep`'s editor/owner ACL + NotFound-masking pattern, validates `stepIds` is exactly a permutation of the pipeline's current step ids (set equality + length) before calling the repo, 422 otherwise.
- `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala` — thin route shell: `PUT /pipelines/:id/steps/order`.
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` — 7 new tests (200 happy path incl. persistence-survives-reload, 404 unknown pipeline, 403 viewer, 3× 422 non-permutation variants, failed-reorder-leaves-positions-unchanged) + a `routesFor`/`grantViewer` fixture helper for the viewer-ACL case.
- `schemas/reorder-pipeline-steps-request.schema.json` (new) — JSON Schema for the request body, keeps `check:schemas` green.

## Frontend

- `frontend/src/features/pipelines/services/pipelineService.ts` — added `reorderPipelineSteps(pipelineId, stepIds)` (`PUT .../steps/order`, returns `PipelineStep[]`).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — added `handleReorderSteps(newOrder)` (design Decision 7: snapshot → optimistic `setSteps` → persisted-ids-only PUT → reconcile by id on success (temp steps left untouched) → revert + `pushToast` on failure); threaded as `onReorderSteps` into `PipelineRiverView`.
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — drag-drop + Move up/down orchestration: `draggedIndex`/`overIndex` state, `onStepDragStart`/`onStepDragEnd` passed to `StepCard`, `onDragOver`/`onDrop` + drop-indicator line on the card-wrapper (`step-section`) divs, `moveStep()` helper shared by the drop handler and the Move buttons, `stepIndex` passed to `StepCard`.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — header restructure (design Decision 4): wrapper `<div>` with the unchanged expand-toggle `<button>` (`flex: 1`) plus a sibling actions cluster; drag handle (design Decision 5 — `aria-hidden` mouse/touch-only surface, keyboard path is the Move buttons) + Move up/Move down buttons; `stepIndex: number` prop; preview-refresh fingerprint extended to `` `${stepIndex}:${JSON.stringify(step.config)}` `` (design Decision 9).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — token-only CSS for the restructured header (`step-card-header` wrapper / `step-card-toggle` / `step-card-actions-cluster` / `step-card-drag-handle` / `step-card-move-btn`) and the `drop-indicator` line.
- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` (new) — drop-handler id-order computation, no-op same-index drop, dragover-without-active-drag guard, Move up/down disable-at-ends + transposition.
- `frontend/src/features/pipelines/ui/StepCard.test.tsx` — `baseProps` extended with the new required props; new tests: Move up/down do not toggle expand/collapse, Move buttons disabled when their handler prop is undefined, expand toggle stays a native `<button>` with `aria-expanded` after the restructure, drag handle is a sibling of the toggle (not nested), drag handle is excluded from the accessibility tree (`aria-hidden`) and fires `onStepDragStart`/`onStepDragEnd` from its own drag events, `stepIndex`-change preview-refresh (open vs. closed).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — mocked `reorderPipelineSteps`; new "reorder (HEL-407)" describe block (optimistic render + persisted-ids-only call + temp-step-stays-in-place reconciliation; failure reverts + toast) and an analyze-re-dispatch-after-reorder test.

## Root-cause note (regression found + fixed during this session)

Every existing `getByRole("button", { name: /<Label>/i })` query elsewhere in `PipelineDetailPage.test.tsx` (13 tests) started failing once the drag handle existed as a named, accessible `<button aria-label="Drag to reorder <Label> step">` — the regex substring-matched both the toggle and the drag handle. **Root cause:** the drag handle was implemented as a focusable, accessibly-named `<button>`, but design.md Decision 5 specifies it should be an `aria-hidden` mouse/touch-only surface (the Move buttons are the keyboard path) — a focusable-but-hidden element is also an accessibility anti-pattern in its own right. **Fix:** changed the drag handle from `<button aria-label="...">` to `<span aria-hidden="true">` (still `draggable` with the same `onDragStart`/`onDragEnd` wiring), which is both design-compliant and resolves the accessible-name collision. **Probe:** `npx jest --testPathPatterns=PipelineDetailPage.test.tsx` — 13 failures ("Found multiple elements with the role 'button' and name ...") before the fix, `85 passed, 85 total` after.

## Cycle 2 — evaluation-1.md change requests

### CR1: drag-drop destination-index off-by-one on downward, multi-position drags

- **Root cause (layer: `PipelineRiverView.tsx`'s drop handler, state→computation boundary):**
  `handleCardDrop` passed `overIndex` — the hovered card's index in the *original*, pre-removal
  `steps` array — straight through to `moveStep(steps, draggedIndex, overIndex)` as the *final*
  resting index. `moveStep` removes the dragged item first, which shifts every later index down
  by one, so for `draggedIndex < overIndex` (a downward drag past more than one card) the item
  landed one slot past the hovered card — after it, not immediately before it where the
  drop-indicator line renders.
- **Probe (test-first, per systematic-debugging):** added
  `PipelineRiverView.test.tsx`'s CR1 test — 4 steps `[Limit, Filter, Sort, Cast]`, drag "Filter
  rows" (index 1), hover over "Cast type" (index 3), drop; assert the resulting id order is
  `["b", "c", "a", "d"]` (Filter directly before Cast). Run against the pre-fix code:
  `npx jest --testPathPatterns=PipelineRiverView.test.tsx -t "CR1"` →
  **received `["b", "c", "d", "a"]`** (Filter after Cast) — reproduces the evaluator's exact live
  repro, confirming the hypothesis.
- **Fix:** in `handleCardDrop`, compute
  `const targetIndex = draggedIndex < overIndex ? overIndex - 1 : overIndex;` and pass
  `targetIndex` (not raw `overIndex`) to `moveStep`. Upward drags (`draggedIndex > overIndex`)
  need no adjustment — nothing before the dragged item's original position shifts — so they're
  unaffected, matching the evaluator's live confirmation that upward drags were already correct.
- **Verification (fresh, post-fix):** `npx jest --testPathPatterns=PipelineRiverView.test.tsx` →
  `8 passed, 8 total` (the CR1 test now green; the two pre-existing drag tests — upward drag,
  same-index no-op — and both Move up/down tests are unaffected, confirming the fix is scoped to
  the reported symptom). Full frontend suite re-run: `1788 passed, 1788 total`.
- Move up/down (`handleMoveUp`/`handleMoveDown`) are separate functions that never call through
  `handleCardDrop` — untouched by this fix, matching the evaluator's "don't disturb keyboard
  reorder" instruction.

### CR2 (minor): CSS token violation

`PipelineDetailPage.css`'s `.pipeline-detail-page__step-card-toggle` rule hardcoded
`gap: 10px`; changed to `gap: var(--space-2)`, matching the sibling
`.pipeline-detail-page__step-card-header` rule one line above (DESIGN.md §3 token rule).

### Gates re-run this cycle (fresh)

- `npm run lint` — clean.
- `npm run format:check` — clean (after `prettier --write` on the newly-touched test file).
- `npx jest` (full suite) — `1788 passed, 1788 total`.
- `npm run check:schemas` — clean.
- `npm --prefix frontend run build` — succeeds.
- Backend untouched this cycle (only `PipelineRiverView.tsx`, its test file, and
  `PipelineDetailPage.css` changed) — `sbt test` not re-run, per the orchestrator's instruction.

## Cycle 3 — skeptic-final-1.md change requests (final gate, round 1, REFUTE)

### CR1: AC2's "surfacing" half not met for ~19 of ~20 step types

- **Root cause (layer: `StepCard.tsx`'s presentational render — a pre-existing scoping gap,
  `git blame` confirms it predates HEL-407 at commit `822debe02`, that reordering newly exposes
  broadly):** `validationError` was threaded into `StepCard` but only ever passed on to
  `ComputeFieldConfig` (`step.opType.id === "compute"` branch); every other op branch
  (`select`/`rename`/`cast`/`filter`/`aggregate`/`limit`/`sort`/`splittext`/`extractheadings`/
  `chunkbytokencount`/`datebucket`/`pivot`/`window`/`unpivot`/`dedupe`/`fillnull`/`stringops`/
  `union`/`lookup`/`assert`) silently dropped it — no error text, badge, or visual cue anywhere.
  Reordering is what makes this reachable broadly: it's the only way a picker-constrained step
  (whose config a user can normally only set to already-valid values via a dropdown/checkbox
  list) reaches an invalid state at all, for any op type.
- **Probe:** added `StepCard.test.tsx`'s "a non-compute step with a validationError shows the
  error text in the expanded card" test (renders a `limit` step — a representative non-`compute`
  op — with `validationError` set, expects the error text visible once expanded). Temporarily
  reverted the fix and re-ran just that test:
  `npx jest --testPathPatterns=StepCard.test.tsx -t "CR1"` → **1 failed** (`getByText` couldn't
  find "Unknown field(s): 'full_name'" — the predicted symptom, exactly). Restored the fix and
  re-ran: **3 passed, 3 total** (including a "compute renders the error once, not twice" guard
  and a "renders nothing extra when validationError is absent" guard).
- **Fix:** `StepCard.tsx` now imports the already-shared `InlineError` component
  (`frontend/src/shared/chrome/InlineError.tsx`, previously imported only by
  `ComputeFieldConfig.tsx`) and renders it once, op-type-agnostically, in the expanded body
  immediately after `StepSchemaDiffChips`, gated on `step.opType.id !== "compute"` (so `compute`
  steps keep their existing, more specific placement inline below the expression input in
  `ComputeFieldConfig` — no double-render).
- **Verification (fresh, post-fix):** `npx jest --testPathPatterns="StepCard.test.tsx|ComputeFieldConfig.test.tsx"`
  → `40 passed, 40 total` (no regression to `ComputeFieldConfig`'s own pre-existing
  `validationError` tests). Full frontend suite re-run: `1791 passed, 1791 total`.

### CR2 (doc): design.md Decision 8 overclaimed a nonexistent "badges" mechanism

Corrected Decision 8's wording: it previously claimed newly-invalid steps "surface through the
existing `validationError` plumbing (badges/editors) with zero additions" — no per-step
validation badge mechanism exists anywhere in the codebase (only unrelated run-status/
schedule-status badges), and before this cycle's CR1 fix `validationError` was in fact rendered
only by `compute`. The doc now accurately states: the *analyze-refresh trigger* is genuinely
zero-additions (`stepsFingerprint` is already order-sensitive), but the *surfacing* mechanism is
the generic `InlineError` render added by this cycle's CR1, not a pre-existing badge system.

### Gates re-run this cycle (fresh)

- `npm run lint` — clean.
- `npm run format:check` — clean (after `prettier --write` on the newly-touched test file).
- `npx jest` (full suite) — `1791 passed, 1791 total` (was 1788; +3 for CR1's new tests).
- `npm run check:schemas` — clean.
- `npm --prefix frontend run build` — succeeds.
- Backend untouched this cycle (only `StepCard.tsx` + `StepCard.test.tsx` changed, plus the
  `design.md` doc fix) — `sbt test` not re-run, per the orchestrator's instruction.

### Note: shared dev DB leftovers not touched

Per the orchestrator's instruction, the skeptic's live-check leftovers (`HEL-407 eval reorder
test` / `Skeptic Test *` pipelines and their data sources) in the shared dev Postgres were left
untouched this cycle — no dev-server session was started, so nothing was created or needed
cleanup here either.

## File-size budget notes (HEL-682 owns the eventual split; not bundled here)

- `StepCard.tsx`: 434 → 503 → **513** lines (+79 total; +10 in cycle 3 for the CR1 generic `InlineError` render + its import + updated doc-comment). Design's Planner Notes estimated ~30-40 lines for the header restructure/actions-cluster/drag-handle/Move-button wiring + 1 line for the fingerprint; actual growth is higher because of doc-comments explaining each design decision inline (Decisions 4/5/9) plus the `aria-hidden` accessibility fix and the cycle-3 validationError-surfacing fix, each with their own comments. Already past the 400-line soft budget pre-change; growth accepted per design, `check:scala-quality`'s frontend counterpart (`format:check`/`lint`) raised no hard failure — file-size warnings are informational only per `CONTRIBUTING.md`.
- `PipelineDetailPage.tsx`: 583 → 626 lines (+43) — the new `handleReorderSteps` handler plus its doc-comment.
- `PipelineRiverView.tsx`: 148 → 219 lines (+71) — drag/drop state + handlers + `moveStep` helper + the drop-indicator/`stepIndex`/Move-button wiring in the render. Still comfortably under budget.
