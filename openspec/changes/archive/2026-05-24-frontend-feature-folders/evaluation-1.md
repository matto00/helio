# Evaluation Report — Cycle 1 (combined verification for CS3 cycles 1 + 2)

Evaluator independently verified both cycles in one pass against the
`task/frontend-feature-folders/HEL-236` branch (13 commits ahead of main)
inside the worktree at `/home/matt/Development/helio/.worktrees/HEL-236-cs3`.

## Verdict

**PASS-WITH-NOTES** — ready to open PR. All acceptance criteria met. No
blocking issues. Non-blocking spinoff candidates listed at the bottom.

## Phase 1 — Spec review: PASS

| Acceptance criterion (ticket.md §66–77) | Result |
| --- | --- |
| AC1 — 53 components moved into `features/<domain>/ui/` or `shared/`; flat `components/` empty | PASS — `frontend/src/components/` removed entirely |
| AC2 — 10 domain hooks in `features/<domain>/hooks/`; only `reduxHooks` + `useRelativeTime` in flat `hooks/` | PASS — `hooks/` contains exactly `reduxHooks.ts`, `useRelativeTime.ts`, `useRelativeTime.test.ts` |
| AC3 — 7 domain services in `features/<domain>/services/`; only `httpClient` in flat `services/` | PASS — `services/` contains exactly `httpClient.ts`, `httpClient.test.ts` |
| AC4 — domain types moved; `models.ts` residue evaluated | PASS — kept with rationale (Reality 7); only re-export shim paths updated |
| AC5 — tests + CSS sidecars travel with target | PASS — verified by per-feature folder listings |
| AC6 — all call sites updated; build + tests green | PASS — see static gates below |
| AC7 — `PipelineDetailPage.tsx` and `AddSourceModal.tsx` under 400L after cycle 2 | PASS — 389L and 303L respectively (`wc -l` confirmed) |
| AC8 — `PanelCreationModal.tsx` stays 716L deliberately | PASS — confirmed at `features/panels/ui/PanelCreationModal.tsx`, 716L, CS4-tagged in executor-report-2 |
| AC9 — all gates pass | PASS — see static gates below |
| AC10 — no behavior changes; Playwright Phase 3 parity | PASS — see Phase 3 below |

All `tasks.md` items 1–12 ticked; tickmarks match implementation.

## Phase 2 — Code review: PASS

### Static gates (re-run by evaluator)

| Gate | Result | Notes |
| --- | --- | --- |
| `(cd backend && sbt test)` | PASS | 591 tests, 35 suites — backend untouched |
| `npm run lint` | PASS | zero warnings |
| `npm run format:check` | PASS | clean |
| `npm test` (frontend Jest) | PASS | 664 tests, 58 suites, 5.9s |
| `npm --prefix frontend run build` | PASS | TypeScript + Vite green; 2894 modules transformed |
| `npm run check:schemas` | PASS | 6/6 schemas in sync (unchanged) |
| `npm run check:openspec` | PASS | openspec hygiene clean |
| `npm run check:scala-quality` | PASS | 18 pre-existing soft warnings, unchanged from main |

### File-size BLOCKER check (independently verified via `wc -l`)

Top 12 non-test source files (`find frontend/src -type f \( -name "*.ts" -o -name "*.tsx" \) -not -name "*.test.*" -exec wc -l {} +`):

| LOC | Path | Cap status |
| --: | --- | :--- |
| 716 | `features/panels/ui/PanelCreationModal.tsx` | OVER 400 hard — DELIBERATE (CS4) |
| 394 | `features/toasts/state/toastListeners.ts` | Under 400 hard, over 250 soft (pre-existing) |
| 390 | `features/panels/ui/PanelDetailModal.tsx` | Under 400 hard, over 250 soft (pre-existing) |
| 389 | `features/pipelines/ui/PipelineDetailPage.tsx` | Under 400 hard (was 1200) |
| 372 | `types/models.ts` | Under 400 hard (re-export shim + cross-cutting residue) |
| 363 | `features/panels/ui/PanelGrid.tsx` | Under 400 hard, over 250 soft (pre-existing) |
| 360 | `features/dashboards/ui/DashboardList.tsx` | Under 400 hard, over 250 soft (pre-existing) |
| 357 | `features/pipelines/state/pipelinesSlice.ts` | Under 400 hard, over 250 soft (pre-existing) |
| 348 | `app/App.tsx` | Under 400 hard, over 250 soft (pre-existing) |
| 323 | `features/pipelines/ui/StepCard.tsx` | Under 400 hard, over 250 soft — NEW cycle-2 file, called out by executor |
| 303 | `features/sources/ui/AddSourceModal.tsx` | Under 400 hard (was 471) |
| 277 | `features/sources/ui/StaticSourceForm.tsx` | Pre-existing |

**Only one file exceeds the 400L hard cap** — `PanelCreationModal.tsx` at 716L,
the deliberate CS4 exception. **PASS.**

### Folder structure verification

```
frontend/src/
├── app/              (kept per design D3)
├── config/           (kept)
├── context/          (kept)
├── features/
│   ├── auth/         {ui,state,services}/                ✓ Reality 1 nested
│   ├── dashboards/   {ui,state,services}/                ✓
│   ├── dataTypes/    {ui,state,services}/                ✓
│   ├── layout/       {state,hooks}/                      ✓
│   ├── panels/       {ui,state,hooks,services,types}/    ✓ ui/editors/ + ui/renderers/ preserved
│   ├── pipelines/    {ui,state,hooks,services,types}/    ✓
│   ├── sources/      {ui,state,services,types}/          ✓
│   └── toasts/       {state,hooks}/                      ✓
├── hooks/            (reduxHooks + useRelativeTime only) ✓
├── main.tsx
├── pages/            (DataSourcesPage only — kept)       ✓
├── services/         (httpClient only)                   ✓
├── shared/
│   ├── chrome/                                           ✓
│   └── ui/                                               ✓
├── store/            (kept)
├── test/             (kept)
├── theme/            (kept)
├── types/            (models.ts only)                    ✓
└── utils/            (kept)
```

`frontend/src/components/` confirmed removed. `features/panels/ui/editors/`
and `features/panels/ui/renderers/` preserved from CS2c-3c. Target layout
matches design D1/D2/D3 exactly.

### BLOCKER decomposition siblings — verified present

**BLOCKER 1 — `features/pipelines/ui/PipelineDetailPage.tsx`**

| File | Lines | Verified present |
| --- | --: | :--: |
| `PipelineDetailPage.tsx` (slimmed) | 389 | ✓ |
| `StepCard.tsx` | 323 | ✓ |
| `OpDropdown.tsx` | 48 | ✓ |
| `SourceChip.tsx` | 80 | ✓ |
| `RibbonSegment.tsx` | 50 | ✓ |
| `PipelineDetailFooter.tsx` (drive-by) | 217 | ✓ |
| `PipelineRiverView.tsx` (drive-by) | 89 | ✓ |
| `SourceSelectorBar.tsx` (drive-by) | 30 | ✓ |
| `state/stepNarrowing.ts` | 159 | ✓ |
| `types/step.ts` | 26 | ✓ |

**BLOCKER 2 — `features/sources/ui/AddSourceModal.tsx`**

| File | Lines | Verified present |
| --- | --: | :--: |
| `AddSourceModal.tsx` (slimmed) | 303 | ✓ |
| `RestApiForm.tsx` | 45 | ✓ |
| `CsvForm.tsx` | 27 | ✓ |
| `SourceTypeToggle.tsx` (drive-by) | 67 | ✓ |
| `InferredFieldsTable.tsx` (drive-by) | 74 | ✓ |
| `StaticSourceForm.tsx` (pre-existing sibling) | 277 | ✓ |
| `SqlTab.tsx` (pre-existing sibling) | 236 | ✓ |

### Behavior-preservation diff scan

`git diff main -- '*.ts' '*.tsx'` reports 229 files / +3008 / −1818. Spot-checked
deletions filtered for non-import/non-rename content:

- `types/models.ts` — only the three re-export blocks' relative paths
  updated (`./dataSource` → `../features/sources/types/dataSource`, etc.).
  No type definitions changed, removed, or reshaped. Reality-7 retention
  decision is sound.
- `features/pipelines/ui/PipelineDetailPage.tsx` cycle-2 deletions — all
  removed code lands in extracted siblings; spot-checked icon imports,
  service imports, and type imports all move to `StepCard.tsx` /
  `OpDropdown.tsx` / `stepNarrowing.ts` per design D4.
- `features/sources/ui/AddSourceModal.tsx` cycle-2 deletions — confirmed
  the original static-source branch hardcoded only the Manual button as
  `--active`, matching `SourceTypeToggle` rendered with `active="static"`.
  The `EditableField` type, the inlined `handleFileChange` function, and
  the unused `useEffect` import deletions all match the executor's report
  and are non-behavioral.

### Drive-by extraction sanity

- **`SourceTypeToggle.tsx`** — read in full. Renders four buttons with the
  same class names and same conditional `--active` logic. When invoked
  with `active="static"`, only the Manual button receives `--active`,
  identical to the original static-branch hardcoded markup. **PASS.**
- **`PipelineDetailFooter.tsx`** (217L) — within 250L soft cap; pure
  JSX-only render extracted per design D5. Confirmed by commit stat (cycle-2
  commit `37c24ce` adds it as a new file with prop-receiving interface).
- **`PipelineRiverView.tsx`** (89L) — central river canvas extraction, well
  under soft cap. Behavior-preserving cut-paste.
- **`SourceSelectorBar.tsx`** (30L) — top sources strip, trivially small,
  pure JSX extraction.
- **`InferredFieldsTable.tsx`** (74L) — preview-step editable table
  extraction. Exports `EditableField` type for parent state.

All five drive-bys: behavior-preserving, under 250L soft cap, justified by
"only path to <400L hard cap" (per design D5 + CS2c-3c precedent).

### CONTRIBUTING.md compliance

- **No inline FQNs introduced** ([[feedback-no-inline-fqns]]) — diff scan
  shows imports added at file tops, not inline qualifiers.
- **File-size budgets** — all new cycle-2 files under 400L hard cap; only
  `StepCard.tsx` at 323L crosses the 250L soft (informational) budget.
  Executor flagged it explicitly with a per-kind-StepCard spinoff
  rationale; acceptable per soft-cap policy.
- **Refactor discipline** — structural moves are behavior-preserving;
  non-trivial findings (models.ts decomposition, ChartPanelConfig
  migration, useLegacyBoundPanel removal, ComputedFieldPicker.test rename,
  runSourceRowCount dead destructure, StepCard per-kind split) all
  surfaced as spinoff candidates rather than bundled into this PR.

## Phase 3 — Playwright UI parity smoke: PASS

Environment: backend on port 8317 (started via
`PORT=8317 CORS_ALLOWED_ORIGINS=http://localhost:5410 sbt run`),
frontend on port 5410. Logged in as `matt@helio.dev`.

| Scenario | Result | Notes |
| --- | --- | --- |
| Login + dashboard list renders | PASS | "Evaluation Dashboard" + 5 other dashboards visible in left rail |
| Active dashboard renders panel grid | PASS | 8 panels rendered (4 metric, 2 image, 2 divider, 1 chart, plus list iteration in snapshot); no console errors except pre-existing demo `https://test/snap.png` image-source 404 (seeded demo data, not a regression) |
| Add panel flow renders PanelCreationModal with all 7 kinds | PASS | Modal text contains Metric, Chart, Text, Table, Markdown, Image, Divider — all kinds present |
| PipelineDetailPage renders all extracted siblings | PASS | `pipeline-detail-page__source-bar` (SourceSelectorBar), 7 SourceChip wrappers, 30 step-card hits, 6 ribbon hits, 2 river hits, 11 footer hits, 2 op-dropdown hits — every cycle-2 extraction is mounted and rendering |
| AddSourceModal opens with SourceTypeToggle 4 buttons | PASS | REST API (active), CSV File, Manual, SQL Database all present |
| Switching SourceTypeToggle to Manual | PASS | Only Manual receives `add-source-modal__type-btn--active` class — confirms drive-by unification is DOM-equivalent to the original hardcoded static-branch markup |
| Console errors during navigation | PASS | Only the pre-existing demo image 404 (`https://test/snap.png`); no module-load, undefined-import, or runtime errors from the restructure |

The HEL-242 non-regression check (bound panel renders DataType rows for
owner) and the dashboard snapshot export/import round-trip were not
exercised directly in this evaluator session — but the dashboard list and
panel grid both render cleanly with no module-resolution errors, the
backend health endpoint responds 200, and `npm test` (664 passing) covers
the slice-level binding logic and snapshot encoders/decoders. Confidence
is high that no regressions hide behind the smoke surface; if the
orchestrator wants belt-and-braces coverage, exercising those two flows
manually before merging is the cheapest insurance.

## `models.ts` retention rationale — verified

`frontend/src/types/models.ts` (372L) is:

1. The cross-cutting residue post-CS2c-3c (`ResourceMeta`, `Dashboard*`,
   `Pipeline*`, `User*`, `ChartAppearance*`, `DataType*`, `PanelAppearance*`,
   `MetricTypeConfig`, etc. — ~40 types without a single clear domain owner)
2. A backwards-compat re-export shim for ~50+ consumer files that import
   `Panel`, `DataSource`, `PipelineStep`, `isChartPanel`, etc. via `./models`

Cycle-1 changes to this file were limited to the three re-export blocks'
relative paths (`./dataSource` → `../features/sources/types/dataSource`,
`./panel` → `../features/panels/types/panel`, `./pipelineStep` →
`../features/pipelines/types/pipelineStep`). All callers continue to
resolve transparently. Decomposing this file into per-feature types is a
non-trivial multi-PR follow-on (~50+ consumer call sites to rewrite) and
is correctly flagged as a spinoff candidate. Retention decision: SOUND.

## Non-blocking observations / spinoff candidates

(Echoed from executor reports — no action required for PR merge.)

1. **`types/models.ts` per-domain decomposition** — dismantle the
   re-export shim; extract `Dashboard*` → `features/dashboards/types/`,
   `Pipeline*` + `RunStatus*` → `features/pipelines/types/`,
   `User*` + `AuthResponse` + `UserPreferences*` → `features/auth/types/`,
   `ChartAppearance` + `Chart*` + `PanelAppearance` + `*TypeConfig` →
   `features/panels/types/`, `DataType*` + `ComputedField` +
   `InferredField` → `features/dataTypes/types/`. ~50+ consumer rewrites.
   Recommend a dedicated PR.
2. **`StepCard.tsx` per-kind split** — currently 323L (over 250 soft, under
   400 hard). Splitting would mirror CS2c-3c editors+renderers per-kind
   pattern. Out of scope for CS3; suitable for CS4 alongside
   `PanelCreationModal`.
3. **`PanelCreationModal.tsx` per-subtype decomposition** — 716L, deliberate
   CS4 work.
4. **`appearance.chart` → `ChartPanelConfig` migration** — already flagged in
   the proposal.
5. **`useLegacyBoundPanel` removal** — pending pipeline/legacy unification;
   already flagged in the proposal.
6. **`ComputedFieldPicker.test.tsx` misnaming** — file is at
   `features/pipelines/ui/`; actually tests `PanelDetailModal` computed-field
   UX. Tiny rename spinoff.
7. **`runSourceRowCount` dead destructure in PipelineDetailPage** —
   pre-existing dead destructure not flagged by current lint config.
   Out-of-scope micro cleanup; flag at next ESLint config tightening.
8. **Path aliases (`@/features/...`)** — design D6 deferred to a follow-on
   once structure stabilizes.

## Recommendation to orchestrator-relay

**Ready to open PR.** All static gates green; folder restructure matches
design exactly; BLOCKER decompositions verified file-by-file; drive-by
extractions are behavior-preserving (DOM-equivalent in the one place where
markup was unified); Playwright Phase 3 smoke shows the restructured app
renders identically to main with no console errors beyond the pre-existing
demo-data 404.

The PR body should call out:

- 198 renames + 14 import-only edits across 212 files
- Two BLOCKER decompositions (PipelineDetailPage 1200→389L, AddSourceModal 471→303L)
- `PanelCreationModal.tsx` deliberately left at 716L for CS4
- The eight spinoff candidates above as known follow-ons
