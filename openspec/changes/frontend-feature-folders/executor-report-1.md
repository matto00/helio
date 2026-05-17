# Executor Report — CS3 cycle 1

## Scope completed

Tasks 1, 2.1–2.8, 3.1–3.5, 4.1–4.7, 5.1–5.3, 6.1–6.4, 7.1–7.2, 8.1–8.10 from
`tasks.md`. Cycle 1 mechanical restructure is complete; cycle 2 (BLOCKER
decompositions for PipelineDetailPage and AddSourceModal) is now ready.

## Files moved per domain

| Feature           | ui | state | hooks | services | types | Σ |
| ----------------- | -: | ----: | ----: | -------: | ----: | -: |
| auth              | 13 | 2     | 0     | 1        | 0     | 16 |
| dashboards        | 5  | 4     | 0     | 1        | 0     | 10 |
| dataTypes         | 7  | 2     | 0     | 1        | 0     | 10 |
| sources           | 11 | 2     | 0     | 1        | 1     | 15 |
| pipelines         | 27 | 2     | 3     | 1        | 1     | 34 |
| panels            | 27+13 (incl. editors/renderers subdirs) | 8 | 7 | 1 | 1 | 57 |
| layout            | —  | 2     | 2     | —        | —     | 4  |
| toasts            | —  | 3     | 1     | —        | —     | 4  |
| shared/chrome     | 16 | —     | —     | —        | —     | 16 |
| shared/ui         | 11 | —     | —     | —        | —     | 11 |
| **Total renames** |    |       |       |          |       | **~177** |

Counts include `.css` sidecars and `.test.tsx`/`.test.ts` test files (they
travel with their target per design D7).

## Import-path updates

`git diff --name-only main...HEAD` reports **212** files changed
(198 renames + ~14 import-only edits in pre-existing top-level files like
`app/App.tsx`, `main.tsx`, `pages/DataSourcesPage.tsx`, `store/store.ts`,
`test/renderWithStore.tsx`, and `types/models.ts`).

Each commit's import rewrite was performed with a Python helper
(`/tmp/cs3_move.py`) that performs `git mv` for every pair in a JSON mapping
and then walks `frontend/src/**/*.{ts,tsx}` rewriting every relative
specifier so it points at the file's new location. The helper handles `from`,
side-effect `import`, dynamic `import()`, `require()`, `jest.mock`,
`jest.requireActual`, `jest.unmock`, and `jest.doMock`. After each commit
group I ran `npm run build` and `npm test` to verify imports resolved.

## Reality decisions

### Reality 1 — `features/auth/` migrated to nested layout

`features/auth/` previously held `LoginPage.tsx`, `OAuthCallbackPage.tsx`,
`RegisterPage.tsx`, `authSlice.ts`, `auth.css` at the flat level. To keep
features uniform, migrated all of it to `features/auth/{ui,state,services}/`
and pulled `UserMenu.tsx`, `ProtectedRoute.tsx`, `PublicOnlyRoute.tsx` in
from `components/` (they're auth-owned chrome, not cross-cutting).

### Reality 2 — CS2c-3c `components/panels/{editors,renderers}/` subtree

Moved into `features/panels/ui/{editors,renderers}/`. Preserved the
editors/renderers split.

### Reality 3 — `ChartPanel.tsx` / `DividerPanel.tsx` / `ImagePanel.tsx` / `MarkdownPanel.tsx`

**LIVE, not dead.** Each is the inner render primitive wrapped by the
corresponding CS2c-3c renderer (`features/panels/ui/renderers/ChartRenderer.tsx`
imports and wraps `ChartPanel.tsx`, etc.). Confirmed by reading both files
plus consumer search: `ChartRenderer` calls `<ChartPanel ... />`,
`DividerRenderer` calls `<DividerPanel ... />`, etc. All four moved into
`features/panels/ui/` alongside the renderers.

### Reality 4 — CSS + test sidecars

For every `.tsx` move, the sibling `.css` and `.test.tsx` were moved with it
in the same `git mv` batch (e.g. `PanelGrid.tsx` + `PanelGrid.css` +
`PanelGrid.test.tsx` all land at `features/panels/ui/`).

### Reality 5 — `components/panels/` parent dropped during move

Editors and renderers landed at `features/panels/ui/{editors,renderers}/`,
NOT `features/panels/ui/panels/{editors,renderers}/`. The redundant `panels/`
parent dir was dropped.

### Reality 6 — `pages/DataSourcesPage.tsx` stays at `pages/`

Per design D3: it's a route-level page and remains at `frontend/src/pages/`.
Only its imports were touched (other files it imports moved to features).

### Reality 7 — `models.ts` residue decision: **kept**

`frontend/src/types/models.ts` (367L) was audited as part of cycle 1. The
residue is predominantly cross-cutting and re-export shim:

- **Cross-cutting types** (kept, no clear single domain owner):
  `ResourceMeta`, `DashboardAppearance`, `DashboardLayoutItem`,
  `DashboardLayout`, `Dashboard`, `ChartLegend`, `ChartTooltip`,
  `ChartAxisLabel`, `ChartAxisLabels`, `ChartAppearance`, `PanelAppearance`,
  `DataTypeField`, `ComputedField`, `DataType`, `InferredField`,
  `StaticColumnType`, `StaticColumn`, `StaticSourcePayload`,
  `MappedPanelData`, `DuplicateDashboardResponse`, `DashboardSnapshot*`,
  `UserPreferences`, `User`, `PipelineSummary`, `AuthResponse`,
  `DashboardUpdatePayload`, `UpdateDashboardBatchRequest`, `PanelBatchItem`,
  `UpdatePanelsBatchRequest`, `UpdatePanelsBatchResponse`,
  `UserPreferencePayload`, `Pipeline`, `RunStatus`, `RunStatusResponse`,
  `UpdateUserPreferenceRequest`, `PanelPaginationState`, `PipelineRunRecord`,
  `MetricTypeConfig`, `ChartTypeConfig`, `ImageTypeConfig`, `DividerTypeConfig`,
  `TypeConfig`, `PanelUpdateFields`.
- **Re-export shims** (kept for backwards compatibility with imports written
  against `./models`): the three blocks re-exporting from `./dataSource`,
  `./panel`, `./pipelineStep` (now `./../features/sources/types/dataSource`,
  `./../features/panels/types/panel`, `./../features/pipelines/types/pipelineStep`).

The file's only updates this cycle were the relative paths inside those three
re-export blocks. Many of the cross-cutting types have a natural per-domain
owner candidate (e.g. `Dashboard` → dashboards/types, `Pipeline` → pipelines/types,
`User` → auth/types, `ChartAppearance` → panels/types, `DataType` →
dataTypes/types), but extracting them would be a non-trivial multi-file
follow-on requiring careful audit of every consumer. **Per the refactor
discipline rule** ("structural refactors must be behavior-preserving — flag
non-trivial findings as spinoff candidates"), I have NOT performed that
extraction in this cycle and surface it as a spinoff candidate below.

### Auth folder structure migration (Reality 1)

Same as Reality 1 above.

## Out-of-scope spinoff candidates surfaced

1. **`types/models.ts` per-domain decomposition** — extract `Dashboard*` →
   `features/dashboards/types/`, `Pipeline*` + `RunStatus*` →
   `features/pipelines/types/`, `User*` + `AuthResponse` + `UserPreferences*`
   → `features/auth/types/`, `ChartAppearance` + `Chart*` + `PanelAppearance`
   + `MetricTypeConfig`/`ChartTypeConfig`/`ImageTypeConfig`/`DividerTypeConfig`
   + `TypeConfig` + `PanelUpdateFields` + `PanelBatchItem` +
   `UpdatePanelsBatch*` → `features/panels/types/`, `DataType*` + `ComputedField`
   + `InferredField` → `features/dataTypes/types/`. Each move requires touching
   all consumers (since the re-export shim would need to be dismantled).
   ~50+ consumer files. Recommend a dedicated PR.
2. **`appearance.chart` → `ChartPanelConfig` migration** — already noted as
   spinoff in the proposal.
3. **`useLegacyBoundPanel` removal** — already noted as spinoff in the proposal.
4. **Path aliases** (`@/features/...`) — per design D6, NOT introduced in
   this PR. Possible follow-on once the new structure stabilizes.

## Gates run

All gates run from `/home/matt/Development/helio/.worktrees/HEL-236-cs3`:

| Gate                                          | Result | Notes                                  |
| --------------------------------------------- | ------ | -------------------------------------- |
| `sbt test` (backend sanity)                   | PASS   | 591 tests, 35 suites — backend untouched |
| `npm run lint` (zero-warnings)                | PASS   |                                        |
| `npm run format:check`                        | PASS   | Re-run prettier --write after each move set to keep clean |
| `npm test` (frontend Jest)                    | PASS   | 664 tests, 58 suites                   |
| `npm --prefix frontend run build`             | PASS   | TypeScript + Vite — verified after every commit |
| `npm run check:schemas`                       | PASS   | 6/6 schemas in sync                    |
| `npm run check:openspec`                      | PASS   | openspec/ clean                        |
| `npm run check:scala-quality`                 | PASS   | 18 pre-existing soft warnings (backend, unchanged) |
| `openspec validate frontend-feature-folders`  | FAIL   | Refactor-only change has no spec deltas — same status as `2026-05-13-backend-routes-decompose` and other prior behavior-preserving refactor changes (project convention) |
| Pre-commit hook (Husky)                       | PASS   | Each of the 9 commits ran the full chain |
| No file >400L hard cap INTRODUCED             | PASS   | Only pre-existing 3 (PipelineDetailPage 1200L, PanelCreationModal 716L, AddSourceModal 471L) remain over-cap |

The `openspec validate` mismatch is intentional and matches project precedent
for behavior-preserving refactors. The `check:openspec` (hygiene) script that
pre-commit enforces passes clean.

## New soft-cap files (>250L) introduced

**None.** Every file >250L in the post-move tree existed at >250L on `main`;
this cycle only relocated them. The current list of feature-folder files
over the 250L soft cap (informational, all pre-existing):

| LOC | Path |
| --: | --- |
| 1366 | features/pipelines/ui/PipelineDetailPage.test.tsx |
| 1200 | features/pipelines/ui/PipelineDetailPage.tsx (over 400L — cycle 2) |
| 874 | features/panels/ui/PanelList.test.tsx |
| 850 | features/panels/ui/PanelCreationModal.test.tsx |
| 802 | features/pipelines/state/pipelinesSlice.test.ts |
| 797 | features/panels/ui/PanelDetailModal.test.tsx |
| 716 | features/panels/ui/PanelCreationModal.tsx (over 400L — CS4) |
| 471 | features/sources/ui/AddSourceModal.tsx (over 400L — cycle 2) |
| 462 | features/panels/state/panelsSlice.test.ts |
| 442 | features/dashboards/state/dashboardsSlice.test.ts |
| 394 | features/toasts/state/toastListeners.ts |
| 390 | features/panels/ui/PanelDetailModal.tsx |
| 375 | features/panels/ui/PanelGrid.test.tsx |
| 363 | features/panels/ui/PanelGrid.tsx |
| 360 | features/dashboards/ui/DashboardList.tsx |
| 357 | features/pipelines/state/pipelinesSlice.ts |
| 310 | features/pipelines/ui/AggregateConfig.test.tsx |
| 304 | features/pipelines/hooks/usePipelineRunEvents.test.ts |
| 301 | features/auth/state/authSlice.test.ts |
| 277 | features/sources/ui/StaticSourceForm.tsx |

## Nuance for evaluator sanity-check

1. **Renames vs edits**: Git's rename detection (`-M` default) reported 198
   renames for this PR, but a few are below the default similarity threshold
   (e.g. some small files like `Renderers/DividerRenderer.tsx` at 60%) because
   imports changed. `git log --stat -M50%` or `--follow` will show the
   continuous history.
2. **`models.ts` re-export shim integrity**: The three re-export blocks in
   `types/models.ts` were updated to point at the new feature-folder paths
   (`./../features/sources/types/dataSource`, etc.). Every legacy consumer
   that imports through `./models` continues to work unchanged. New code
   should prefer the per-feature import directly.
3. **PanelContent's renderer dispatch**: `features/panels/ui/PanelContent.tsx`
   still relies on the narrowing helpers (`isChartPanel`, `isMarkdownPanel`,
   etc.) from `features/panels/state/panelNarrowing.ts`. Dispatch is
   unchanged from CS2c-3c.
4. **Empty subdirectories**: After the moves I removed `components/`
   entirely (now empty). `hooks/`, `services/`, `types/` survive at the
   top level with only their cross-cutting residue per design D3.
5. **Three BLOCKERs over the 400L cap remain**:
   - `features/pipelines/ui/PipelineDetailPage.tsx` (1200L) — cycle 2
   - `features/sources/ui/AddSourceModal.tsx` (471L) — cycle 2
   - `features/panels/ui/PanelCreationModal.tsx` (716L) — CS4 (per-subtype
     decomposition territory; mirrors CS2c-3c editors+renderers pattern)
6. **`ComputedFieldPicker.test.tsx`** is a misnamed historical test that
   actually exercises `PanelDetailModal` (no `ComputedFieldPicker.tsx` source
   file exists). Kept under `features/pipelines/ui/` since it tests
   pipeline-adjacent computed-field UX inside the modal. Rename for clarity
   could be a tiny spinoff.

## Commit log (9 commits)

```
e97165f HEL-236 CS3 cycle 1: features/layout + features/toasts — state/hooks nesting
1e6de56 HEL-236 CS3 cycle 1: features/panels — ui/state/hooks/services/types nesting
fdf9d4d HEL-236 CS3 cycle 1: features/pipelines — ui/state/hooks/services/types nesting
79e1aa8 HEL-236 CS3 cycle 1: features/sources — ui/state/services/types nesting
ad27f4f HEL-236 CS3 cycle 1: features/dataTypes — ui/state/services nesting
4272ee7 HEL-236 CS3 cycle 1: features/dashboards — ui/state/services nesting
2327a0e HEL-236 CS3 cycle 1: features/auth — nested ui/state/services restructure
f30bb19 HEL-236 CS3 cycle 1: shared/ chrome + ui — cross-cutting UI evacuated from components/
a52bf08 HEL-236 CS3 cycle 1: OpenSpec change folder (frontend-feature-folders)
```

Each commit passes the full pre-commit hook chain. `git bisect` between any
two commits is safe.
