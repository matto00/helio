## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 5 ticket ACs addressed explicitly:
  - Shape offering + instantiate-and-bind flow implemented in `DataTypeSelectStep.tsx` / `ShapeInstantiateStep.tsx` / `PanelCreationModal.tsx`.
  - Panel-type → shape mapping implemented (`panelShapes.ts`, `PANEL_TYPE_SHAPES`) and documented (design.md Decision 4, spec `panel-creation-datatype-step`).
  - Persistence decision explicitly documented (design.md Decision 2: no migration) — no Flyway/backend changes present in the diff (`git diff main...HEAD --stat -- backend schemas openspec/specs` is empty), consistent with the decision.
  - Tests present for the full instantiate chain (`ShapeInstantiateStep.test.tsx`) and the creation-step shape selection (`DataTypeSelectStep.test.tsx`), plus a live-browser Playwright spec (`e2e/hel399-shape-instantiate.spec.ts`) — independently re-run below.
  - Backward compatible: no backend/schema changes at all; unmapped panel types (text/markdown/collection/timeline) render only the pre-existing DataType list, confirmed via code read and live click-through.
- No AC silently reinterpreted — design.md's decisions (1/2/3/4/5/6/7) are all traceable to explicit ticket language ("if needed...decide in design", "service" ambiguity, etc.) and were gated through two skeptic design rounds (`skeptic-design-1.md`, `skeptic-design-2.md`, workflow-state.md shows round 2 = CONFIRM).
- Tasks.md: all 15 items marked `[x]`; each was independently verified against the actual diff/tests (extraction, mapping, step wiring, tests, live check) — no items claimed done that aren't.
- No scope creep: `git diff main...HEAD --stat` shows only the files described in files-modified.md plus expected OpenSpec artifacts (`.openspec.yaml`, `workflow-state.md`, planning docs). No backend, schema, or unrelated frontend files touched.
- No regressions to existing behavior: full frontend Jest suite (137 suites / 1423 tests) passes; `ShapePickerModal.test.tsx` passes unmodified after the extraction refactor; live-clicked the HEL-402 in-editor "Start from a shape" flow post-refactor and confirmed the params form still renders and behaves identically.
- No API contract changes needed or made (schema-drift check passes; no schemas/openspec/specs backend deltas).
- Planning artifacts (design.md, proposal.md, tasks.md, spec deltas) accurately reflect the implemented behavior — cross-checked design Decisions 1–7 against the actual code (see Phase 2 notes) and found no drift.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md compliance**: no inline FQNs introduced (frontend-only change; `check:scala-quality` scans backend only and reports zero new warnings — all 64 soft warnings are pre-existing backend test files). `git commit -n` bypass verified accurate (see below) and matches the AI-collaborator carve-out precedent already established for this multi-agent workflow (mirrors HEL-393/394/396/398's "Add"+"Archive" pattern).
- **DESIGN.md [mechanical] compliance**: all new/changed CSS (`ShapeParamsFields.css`, `ShapeInstantiateStep.css`, `PanelCreationModal.css` additions) use `--app-*`/`--space-*`/`--text-*`/`--weight-*` tokens exclusively — no hardcoded hex/px font sizes found. Shared components reused throughout (`TextField`, `Textarea`, `Select`, `InlineError`, `Modal`) — no hand-rolled form controls. Button styling reuses the existing `.panel-creation-modal__btn--primary/--secondary` recipe, not a new variant.
- **DRY**: `ShapeParamsFields`/`buildShapeParams` extraction eliminates the prior duplicated `widgetFor` + transform logic between `ShapePickerModal` and the new step — verified both call sites now share one implementation (`git diff` for `ShapePickerModal.tsx`).
- **Readable / modular**: `useShapeOffering` extracted into its own hook specifically to keep `PanelCreationModal.tsx` smaller — appropriate separation of the catalog-fetch concern from the modal shell.
- **Type safety**: no `any`; `BuildShapeParamsResult` is a proper discriminated union; `PipelineShapeCatalogEntry` typed throughout.
- **Error handling**: every stage of the instantiate chain (expand/create/step/run) has an explicit try/catch surfacing `extractErrorMessage` inline via `InlineError` — no silent catch blocks found.
- **Tests meaningful**: 101 tests across the 8 new/changed test files exercise real regression-catching scenarios (422 verbatim message, create/addStep failure leaving `dataTypeId` unset, run-failure retry re-calling only `runPipeline`, `fieldMapping` absence, Back-navigation state clearing) — independently re-run and all pass.
- **No dead code**: no leftover TODO/FIXME; `outputContract.fields` is confirmed unused (only appears as `[]` in test fixtures) per pre-brief point 7 — reported here for the human's later YAGNI call.
- **No over-engineering**: `PANEL_TYPE_SHAPES` is a flat, catalog-filtered map rather than per-shape hardcoded UI, matching the codebase's stated one-widget-per-`dataType` convention.
- **Behavior-preserving refactor**: `ShapePickerModal.tsx`'s extraction verified behavior-preserving two ways — (a) `ShapePickerModal.test.tsx` passes unedited, and (b) live-clicked the in-editor "Start from a shape" flow post-refactor (params form for `single-row` rendered identically to pre-change expectations, no console errors).

**One minor, non-blocking note** (not a mechanical hard-fail; see Non-blocking Suggestions): `PanelCreationModal.tsx` grew from 374 → 433 lines, crossing CONTRIBUTING.md's "General" ~400-line line ("propose a split in the PR description rather than adding to it"). This isn't caught by `check:scala-quality` (backend-only scanner) and CONTRIBUTING.md frames the budget as "soft," so it is not blocking, but a split (or an explicit call-out) wasn't proposed despite already extracting `useShapeOffering` for this stated reason.

**Bypass-commit verification (independently re-run, not taken on faith)**:
- `npm run check:openspec` → fails with exactly the claimed reason: `change "panel-declares-shape-wiring" is complete (15/15) but not archived`. Accurate.
- `npm run check:schemas` → passes (19 protocols, 7 panel-type-enum surfaces in sync).
- `npm run lint` (`eslint src --max-warnings=0`) → passes, zero warnings.
- `npm run format:check` → passes, all files formatted.
- `npm run check:scala-quality` → clean (64 pre-existing soft warnings only, none new).
- `npm test` (full frontend Jest suite) → 137 suites / 1423 tests pass.
- Conclusion: the bypass claim is accurate — `check:openspec` is the only failing hook, for the stated, legitimate reason, and every other check independently reproduces green.

### Phase 3: UI Review — PASS
Issues: none.

Servers started via `scripts/concertino/start-servers.sh` (both reused already-healthy instances on 5572/8479); `assert-phase.sh servers` returned `PASS`.

**Playwright e2e spec independently re-run** (`e2e/hel399-shape-instantiate.spec.ts`, not just read): `npx playwright test e2e/hel399-shape-instantiate.spec.ts` → **1 passed**. This independently confirms both of the executor's flagged claims:
1. An invalid (non-empty but rejected) required shape param (`mode: "not-a-real-mode"`) produces a real backend 422, and the message (`/unknown 'mode' value/i`) is visibly shown inline — the modal stays on shape-instantiate, not silently swallowed (HEL-336 defect guard holds).
2. A full `single-row` (aggregate mode, sum measure) → metric happy path runs to completion (`run` returns 200, `rowCount: 1`), advances to name-entry, and `POST /api/panels` returns 201 with `dataTypeId` set and `fieldMapping` empty (`{}`) — a real bound panel appears on the dashboard.

**Additional manual browser verification** (beyond the automated spec, live in a fresh session):
- Table panel type correctly offers exactly "Pivot / matrix" and "Top N" shape cards (Decision 4 mapping) — confirmed visually and via accessibility snapshot.
- Metric panel type correctly offers only "Single row".
- Selecting a shape card advances to the shape-instantiate step with all required fields present, accessible labels (`Pipeline name`, `Data source`, `Output type name`, `Mode`, etc.), and the submit button correctly `disabled` until all required fields are filled (confirmed via a11y tree, not just visual color).
- Back navigation from shape-instantiate correctly returns to datatype-select with a clean shape-card list (no leftover selection).
- Re-verified the pre-existing HEL-402 in-editor "Start from a shape" flow (`ShapePickerModal`, on `/pipelines/:id`) post-refactor: shape selection → params form renders identically, confirming the extraction is behavior-preserving live, not just in unit tests.
- Zero console errors/warnings across the entire manual session (checked after every major interaction).
- Breakpoints 1440 / 768 both render the shape-card section and shape-instantiate form without layout breakage (screenshots reviewed, no overflow/clipping).
- No new backend endpoint, no Flyway migration, no persisted shape/panel link — confirmed via `git diff main...HEAD --stat -- backend schemas openspec/specs` returning empty.
- `fieldMapping` never auto-populated — confirmed both by code read (`ShapeInstantiateStep.onComplete` only returns `{dataTypeId, pipelineId}`; `PanelCreationModal.handleShapeInstantiateComplete` only calls `setSelectedDataTypeId`; `fieldMapping` does not appear anywhere else in `PanelCreationModal.tsx`) and by the e2e spec's explicit assertion that the created panel's `fieldMapping` is `{}`.

### Overall: PASS

### Non-blocking Suggestions
- `frontend/src/features/panels/ui/PanelCreationModal.tsx` is now 433 lines, past CONTRIBUTING.md's ~400-line "propose a split" threshold (not enforced by the backend-only `check:scala-quality` script, so not a hard-fail). Consider extracting the shape-selection/back/complete handlers (`handleSelectShape`, `handleBackFromShapeInstantiate`, `handleShapeInstantiateComplete`) into a small hook alongside `useShapeOffering`, or flag the split explicitly for a follow-up, per CONTRIBUTING.md's guidance for files crossing that threshold.
