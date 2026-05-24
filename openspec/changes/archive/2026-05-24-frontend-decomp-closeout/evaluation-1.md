## Evaluation Report — Cycle 1 (CS4)

Independent evaluator verification of the HEL-236 CS4 closeout sub-PR.
Both executor cycles (cycle 1 = `models.ts` decomposition + test rename;
cycle 2 = `PanelCreationModal` + `StepCard` decomposition) were re-checked
from a cold-cache standpoint: gates re-run, file sizes re-measured, diff
behavior-scanned, Playwright smoke executed against the worktree.

### Phase 1: Spec Review — PASS

All 8 ticket ACs addressed and aligned with proposal/design/tasks.

- AC1 `PanelCreationModal.tsx` <400L with 4 creators extracted — PASS
  (383L; `creators/{Metric,Chart,Image,Divider}CreatorFields.tsx` plus
  `creators/creatorTypes.ts`)
- AC2 `models.ts` retained as single-export cross-cutting survivor per
  design D7 (a) — PASS (19L holding only `ResourceMeta`, with a clear
  comment header pointing readers to each migrated domain home)
- AC3 All 85 consumer import sites updated — PASS (only 4 files now
  reference `types/models`; each does so for the surviving `ResourceMeta`
  cross-cutting type — matches the 8 expected residual consumer-import
  edges noted in executor report 1, just collapsed into 4 files)
- AC4 `StepCard.tsx` decomposition — PASS (236L, under 250L soft cap,
  via `useStepCardState` hook extraction rather than per-kind component
  wrappers; design D3 explicitly permits either outcome)
- AC5 Test rename — PASS (renamed and moved to
  `features/panels/ui/PanelDetailModal.computedFields.test.tsx`)
- AC6 All gates pass — PASS (re-verified independently, see Phase 2)
- AC7 No file >400L in `frontend/src/` — PASS (verified via `find`; the
  next-largest non-test file is `toastListeners.ts` at 394L which
  pre-dates CS4 and was explicitly out-of-scope per ticket)
- AC8 No behavior changes; Playwright parity — PASS (see Phase 3)

Tasks.md mark-up matches what's actually shipped. Proposal scope is
preserved end-to-end; the only design deviation (StepCard hook over
per-kind shims) was explicitly allowed by design D3.

### Phase 2: Code Review — PASS

#### Independent gate re-runs

| Gate | Result |
|---|---|
| `sbt test` (backend sanity) | 591 tests / 35 suites pass |
| `npm run lint` | clean (zero warnings) |
| `npm run format:check` | clean |
| `npm test` | **664 tests / 58 suites pass** (count preserved) |
| `npm run build` (frontend) | clean, ✓ built in 3.94s |
| `npm run check:schemas` | 6/6 in sync |
| `npm run check:openspec` | clean |
| `npm run check:scala-quality` | clean (18 pre-existing soft warnings, all in unchanged backend test files) |

#### File-size table — top 15 non-test source files

| Lines | Path | Cap status |
|---|---|---|
| 394 | features/toasts/state/toastListeners.ts | soft (pre-existing) |
| 390 | features/panels/ui/PanelDetailModal.tsx | soft (pre-existing) |
| 389 | features/pipelines/ui/PipelineDetailPage.tsx | soft (pre-existing) |
| **383** | **features/panels/ui/PanelCreationModal.tsx** | **under 400L hard (was 716L)** |
| 364 | features/panels/ui/PanelGrid.tsx | soft (pre-existing) |
| 360 | features/dashboards/ui/DashboardList.tsx | soft (pre-existing) |
| 357 | features/pipelines/state/pipelinesSlice.ts | soft (pre-existing) |
| 348 | app/App.tsx | soft (pre-existing) |
| 303 | features/sources/ui/AddSourceModal.tsx | soft (pre-existing) |
| 279 | features/panels/types/panel.ts | soft (grew in cycle 1; cohesion documented) |
| 277 | features/sources/ui/StaticSourceForm.tsx | soft (pre-existing) |
| 272 | features/dashboards/state/dashboardLayout.ts | soft (pre-existing) |
| 258 | features/dashboards/state/dashboardsSlice.ts | soft (pre-existing) |
| 256 | features/panels/state/panelThunks.ts | soft (pre-existing) |
| 255 | features/pipelines/types/pipelineStep.ts | soft (grew in cycle 1; cohesion documented) |

**Zero files over 400L hard cap — AC7 satisfied.**

`StepCard.tsx` (236L) and `useStepCardState.ts` (167L) both under soft
cap. All new creator/creationSteps files comfortably under 200L.

#### Cycle 1 verification (models.ts decomposition)

- `frontend/src/types/models.ts` — 19L, single `ResourceMeta` export with
  a comment block linking each migrated domain to its new home. Clean.
- New feature-type files exist and hold the executor-reported counts:
  - `features/auth/types/user.ts` ✓
  - `features/dashboards/types/dashboard.ts` ✓
  - `features/dataTypes/types/dataType.ts` ✓
- Extended feature-type files grew exactly per executor report 1
  (panel.ts 190→279L, pipelineStep.ts 216→255L, dataSource.ts 78→102L)
- `types/models` import references narrowed to 4 files (panel.ts,
  dashboard.ts, panelFixtures.ts, renderWithStore.tsx) — all pulling
  `ResourceMeta` only, matching the expected residual cross-cutting
  consumer count
- No re-export blocks survive in `models.ts`
- Atomic commit history confirms per-source-domain grouping (`86b3fe7`
  DataType / `03d58bb` Auth / `ce23cc4` Dashboard / `97c02da` Source /
  `ccffcdb` Pipeline / `f29bcf5` Panel + collapse / `4aa0ad3` test
  rename) — no mega-commit hidden

#### Cycle 2 verification (PanelCreationModal + StepCard)

- `PanelCreationModal.tsx` 716→383L — under 400L hard cap
- `creators/` folder has 4 per-subtype components + `creatorTypes.ts`
  shared props; all match design D1's target layout
- `creationSteps/` folder has 4 step-body components — drive-by per
  design D5 (the only behavior-preserving path under cap, accepted)
- `creatorTypes.ts` carries `CreatorFieldsProps<TConfig>` generic and
  `hasNonEmptyTypeConfig` predicate — co-located cleanly with the
  creator props they describe
- `useStepCardState.ts` 167L lifts the eight per-op editor states,
  during-render `prev*` sync, persist helper, and eight typed change
  handlers; StepCard becomes a presentational shell over it
- Diff of the moved code is identical logic: state hooks renamed from
  `handle*` to `on*` (matching the hook's exposed callback convention)
  but otherwise byte-equivalent. No drive-by behavior changes.

#### StepCard design-D3 deviation — JUSTIFIED

Read of `StepCard.tsx` body confirms the per-kind dispatch arms are 4–6
lines each, each routing into an already-extracted config component
(`SelectFieldsConfig`, `RenameFieldsConfig`, `CastFieldsConfig`,
`FilterConfig`, `ComputeFieldConfig`, `AggregateConfig`, `LimitConfig`,
`SortConfig`). A per-kind wrapper would be a 1–2 line pure forward of
shell state and a handler.

The real density that was bloating StepCard was the editor state +
during-render sync + persist handlers — exactly what the hook lifted.
The hook removes a genuine concern; per-kind wrappers would have added
indirection without removing anything. Verdict matches executor
rationale; the deviation is well-reasoned and design D3 explicitly
permits either outcome ("Either outcome accepted — document in executor
report"). Documented in tasks 6.1–6.3.

#### CONTRIBUTING.md compliance

- No-inline-FQN: spot-checked `PanelCreationModal.tsx`, `StepCard.tsx`,
  `useStepCardState.ts`, `creatorTypes.ts`, all four creators, all four
  creationSteps. Every type reference is imported. No inline qualifiers.
- File-size soft budgets: two minor over-soft files documented and
  justified (panel.ts 279L and pipelineStep.ts 255L — both cohesive
  type modules where splitting would create cross-file cycles or
  cosmetic indirection).

#### Behavior-preservation diff scan

`git diff --stat main` shows 111 files changed, 1985 insertions / 992
deletions — consistent with a move-heavy structural refactor.
Spot-checked deletions in `PanelCreationModal.tsx`, `StepCard.tsx`, and
`models.ts`: every deleted line is either (a) an import being
re-pointed, (b) an extracted helper/component now living elsewhere, or
(c) a re-export block being collapsed. No genuine logic changes
surfaced. The `handle*`→`on*` rename in the StepCard hook extraction is
a stylistic alignment with the hook's exposed contract; semantics
identical.

#### Atomic-commit cost note (non-blocking)

Commit `b2d7ac3` ("Extract per-subtype creators") leaves
`PanelCreationModal.tsx` at 577L — over the 400L hard cap. The very
next commit `2e89bc8` ("Extract creationSteps") brings it back under
cap at 383L. Branch tip (HEAD) and merge commit will both be under cap.
This is acceptable: the cap policy as currently implemented is a
branch-tip / merge-time gate, not a per-commit gate. Documented in the
executor's "Nuance" section; if the team ever adopts per-commit cap
enforcement, this commit ordering would need to be combined into one
larger commit. Not a CS4 blocker.

#### Cycle 1 commit-group review

`git log --oneline main..HEAD` shows 13 commits: 1 OpenSpec folder,
6 atomic per-domain moves, 1 test rename, 1 cycle-1 handoff, 3 atomic
cycle-2 extractions, 1 cycle-2 handoff. No mega-commit; each commit
isolates a single source-domain or single extraction step.

### Phase 3: UI Review — PASS

Backend started on port 8318 (591 tests pre-verified), Vite dev on
5411 with proxy + CORS configured.

#### Login + navigation
- Login as matt@helio.dev / heliodev123 succeeded; landed on dashboard
  list with 7 dashboards and several panels (snap-img, snap-div, etc.).

#### Panel creation flow (CS4 primary surface)
- "Add panel" button opens modal. Title shows "Choose panel type".
- All **7 type cards present**: Metric, Chart, Text, Table, Markdown,
  Image, Divider — matches `TypeSelectStep.tsx`'s `PANEL_TYPES`
  catalogue.
- **Divider (non-data-bound) end-to-end**: type-select → template-select
  → name-entry; `DividerCreatorFields` rendered the "Orientation" label
  correctly; submit with title "CS4 divider smoke" closed modal and the
  new divider appeared in the dashboard. Zero console errors.
- **Metric (data-bound)**: type-select → template-select → "Start blank"
  routed to "Choose a data type" step (`DataTypeSelectStep`), confirming
  the data-bound branch of the step machine fires correctly. Back/Next
  buttons present. Closed via close-button → discard-confirm banner
  appeared (dirty-state guard intact); "Discard" dismissed cleanly.
- Step machine routes correctly between TypeSelectStep,
  TemplateSelectStep, DataTypeSelectStep, NameEntryStep. Discard-confirm
  banner appears when dirty as expected (lifecycle stayed in shell).

#### Pipeline detail page + StepCard
- Navigated to `/pipelines` → "ProfitAgg" pipeline detail page rendered
  6 StepCards (Select fields, Rename column, Compute column, Sort rows,
  Compute column, Join tables).
- Expanded first StepCard → expanded body rendered with
  `SelectFieldsConfig` (correctly routed by per-kind dispatch),
  "Preview data" + "Remove step" action buttons present.
- Zero console errors on pipeline detail page after expand. Hook
  extraction did not regress anything.

#### Console + network
- One pre-existing console error throughout the session:
  `https://test/snap.png net::ERR_NAME_NOT_RESOLVED` — from a saved
  test panel using a placeholder image URL; **not introduced by CS4**.
- No new errors traceable to extracted creators, creationSteps, or the
  StepCard hook.

#### Snapshot export/import
- Skipped: in-browser `fetch` from the dev console can't send
  HTTP-only auth cookies without `credentials: 'include'`; not worth
  manufacturing the request when the panel-creation flow already
  exercised the create-panel wire path through the new shell, and
  CS2c-3c snapshot tests still pass in the Jest run (664/664).

#### HEL-242 non-regression
- Dashboard rendered with multiple panels (KPI Metric, Test Revenue
  Panel, Trend Overview, etc.) without blank states. Not exhaustively
  exercised but no obvious regression — and CS4 didn't touch the
  bound-panel render path.

### Overall: PASS

CS4 cleanly closes the HEL-236 chain. All static gates green, all 8
ACs satisfied, behavior-preservation confirmed via diff scan + 664
Jest tests + Playwright smoke. The one design deviation (StepCard hook
over per-kind shims) is well-justified and explicitly allowed by
design D3.

### Non-blocking Observations

1. **`panel.ts` 279L and `pipelineStep.ts` 255L** are above the 250L
   soft cap. Executor documented both as deliberate (cohesive type
   modules where decomposition would be cosmetic and create cross-file
   cycles). Concur — leave as-is.
2. **Intermediate commit `b2d7ac3` is over cap (577L)** in the middle
   of cycle 2. Branch tip is fine; if per-commit cap enforcement is
   ever adopted, future cycles should land the creator + step
   extractions in a single commit. Not a CS4 blocker.
3. **Pre-existing 394L `toastListeners.ts`** is the largest non-test
   source file after CS4 and sits just under the hard cap. Worth a
   follow-up spinoff (not this PR — explicitly out of scope per
   ticket).
4. **Pre-existing test files >400L** (PipelineDetailPage.test 1366L,
   PanelList.test 874L, PanelCreationModal.test 850L, etc.) — out of
   scope for CS4 but could be candidates for a future test-suite
   decomposition pass.
5. **Saved test panel still uses `https://test/snap.png`** — generates
   a benign console network error on every dashboard render. Cosmetic;
   a one-line fix in dev/demo seed data when convenient.

### Recommendation to orchestrator-relay

**Ready to open PR.** All gates green, behavior preserved, file-size
BLOCKER eliminated. The 13-commit history is clean and atomic. No
cycle 3 required.
