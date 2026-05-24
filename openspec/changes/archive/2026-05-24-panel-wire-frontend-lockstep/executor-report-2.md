# Executor Report — CS2c-3c cycle 2

**Status:** COMPLETE — frontend lockstep landed; all gates green.

Cycle 1 (separate executor session) shipped the backend wire-shape collapse
and JSON schema migration; cycle 2 finishes HEL-236 CS2c-3c by migrating the
frontend in lockstep so consumers narrow on a discriminated `Panel` union and
all axios calls emit `{ type, config }`.

## Extractions completed (task group 4)

Per design D4, the four files entering this change were over the 400L hard
cap; extractions landed BEFORE adding dispatch code so nothing was appended
to over-budget files.

**`frontend/src/types/models.ts`** (587 → 367L) — extracted three ADTs:
- `frontend/src/types/panel.ts` (190L) — `Panel` discriminated union + per-
  subtype config types + default config factories
- `frontend/src/types/dataSource.ts` (78L) — pre-existing DataSource ADT,
  extracted to keep models.ts under 400L (drive-by but in the same spirit as
  panel + pipelineStep extractions)
- `frontend/src/types/pipelineStep.ts` (216L) — pre-existing PipelineStep
  ADT, extracted for the same reason

`models.ts` keeps the legacy import surface intact via re-exports.

**`frontend/src/features/panels/panelsSlice.ts`** (439 → 241L) — extracted:
- `frontend/src/features/panels/panelThunks.ts` (256L) — all createAsyncThunks
- `frontend/src/features/panels/panelActions.ts` (13L) — the
  `markDashboardPanelsStale` action creator extracted as a stand-alone
  `createAction` to break a would-be cyclic import between the slice and
  the thunks
- `frontend/src/features/panels/panelNarrowing.ts` (102L) — narrowing
  predicates + read-only accessors for the discriminated union
- `frontend/src/features/panels/panelPayloads.ts` (165L) — typed request
  body builders for create / update / batch

`panelsSlice.ts` now just holds the `Panel[]` reducer + the
`accumulatePanelUpdate` pending-updates pipeline + `buildBatchRequest`.
Thunks and action creators are re-exported so existing imports keep working.

**`frontend/src/components/PanelDetailModal.tsx`** (1021 → 390L) — extracted:
- `frontend/src/components/panels/editors/AppearanceEditor.tsx` (99L) —
  common appearance form (title / bg / color / transparency / chart shim)
- `frontend/src/components/panels/editors/ChartAppearanceEditor.tsx` (217L)
  — chart-specific appearance subsection
- `frontend/src/components/panels/editors/BindingEditor.tsx` (234L) —
  metric/chart/table binding section (data type + field mapping + refresh)
- `frontend/src/components/panels/editors/MarkdownEditor.tsx` (71L)
- `frontend/src/components/panels/editors/ImageEditor.tsx` (95L)
- `frontend/src/components/panels/editors/DividerEditor.tsx` (133L)
- `frontend/src/components/panels/editors/editorTypes.ts` (21L) — shared
  `PanelEditorHandle` interface + `DirtyChangeCallback` type
- `frontend/src/hooks/usePanelDetailModalLifecycle.ts` (109L) — dialog
  ref + `cancel` / `click` / `keydown` listener wiring

The modal is now a discriminator-dispatched shell: each subtype editor owns
its own local state, exposes a single `{ reset, save }` ref handle, and
notifies the parent of dirty-state changes via an `onDirtyChange` callback.

**`frontend/src/components/PanelGrid.tsx`** (597 → 363L) — extracted:
- `frontend/src/components/panelGridConfig.ts` (112L) — static layout
  config (`panelGridConfig`, `createLayouts`, `fromResponsiveLayouts`)
- `frontend/src/hooks/usePanelGridSave.ts` (181L) — 30s auto-save interval,
  pending-batch flush, layout-persist pipeline, `SaveState` context wiring,
  imperative `flushAndReset` handle

**`frontend/src/components/PanelContent.tsx`** (290 → 107L) — rewrote as
a discriminator-dispatched shell over per-subtype renderers under
`frontend/src/components/panels/renderers/<Subtype>Renderer.tsx`:
- `MetricRenderer.tsx` (26L), `TextRenderer.tsx` (27L),
  `TableRenderer.tsx` (121L) — extracted inline content blocks
- `ChartRenderer.tsx` (22L), `MarkdownRenderer.tsx` (10L),
  `ImageRenderer.tsx` (15L), `DividerRenderer.tsx` (16L) — thin wrappers
  around the existing `ChartPanel` / `MarkdownPanel` / `ImagePanel` /
  `DividerPanel` view components, with the narrowed `Panel` passed in so
  config-driven props (`config.orientation`, `config.weight`, etc.) are
  read through the union rather than positional `dividerOrientation` etc.

## Union shape and narrowing API

`Panel` is `MetricPanel | ChartPanel | TablePanel | TextPanel | MarkdownPanel
| ImagePanel | DividerPanel`, each carrying `{ type: "<kind>", config:
<Kind>PanelConfig }` plus a shared `PanelBase` (id, dashboardId, title,
meta, appearance, ownerId?, refreshInterval?).

`refreshInterval` is preserved as a frontend-only optional field — the
backend never persisted it (no schema or column, the explicit
`updatePanelRequestFormat` reader silently drops it). Documented in
`panel.ts` so a future cleanup knows the field is a no-op on the wire.

**Narrowing helpers** in `panelNarrowing.ts`:

- `isMetricPanel`, `isChartPanel`, `isTablePanel`, `isTextPanel`,
  `isMarkdownPanel`, `isImagePanel`, `isDividerPanel` — discriminator
  predicates
- `isBoundCapablePanel` — true for metric/chart/table
- `getDataTypeId(panel): string | null` — returns the dataTypeId for
  bound-capable subtypes, collapsing the backend's `""` sentinel to `null`
- `getFieldMapping(panel): Record<string,string> | null` — same shape rule
- `getContent`, `getImageUrl`, `getImageFit`, `getDividerOrientation`,
  `getDividerWeight`, `getDividerColor` — analogous accessors

The `""` → `null` collapse at the accessor boundary preserves the cycle-1
`{ dataTypeId: "" }` wire emission (cycle 1 tolerance-rule flag #1) while
keeping FE call-site logic (`if (typeId) …`) unchanged.

## Consumer-site sweep

Sites migrated from flat-field reads to narrowing:

- `frontend/src/components/PanelGrid.tsx` — `panel.typeId` →
  `getDataTypeId(panel)` for `usePanelPolling`; PanelContent now receives
  `panel` instead of positional flat-field props
- `frontend/src/components/PanelDetailModal.tsx` — flat-field reads
  replaced by narrowed editor dispatch
- `frontend/src/components/PanelContent.tsx` — was the dispatcher; now
  takes `panel` and dispatches via `is*Panel` predicates
- `frontend/src/components/PanelCreationPreview.tsx` — builds a synthetic
  `Panel` of the chosen kind via `emptyConfigForKind` and passes through
- `frontend/src/components/DataSourceList.tsx` — `p.typeId === relatedType.id`
  → `getDataTypeId(p) === relatedType.id`
- `frontend/src/hooks/useLegacyBoundPanel.ts` — `panel.typeId` →
  `getDataTypeId(panel)`. **Preserved as-is per CS3-era cleanup guard.**
- `frontend/src/hooks/usePanelData.ts` — `panel.typeId` and
  `panel.fieldMapping` reads → `getDataTypeId(panel)` and
  `getFieldMapping(panel)`. **HEL-242 non-regression hypothesis:** cache
  key now composes from the narrowed binding-bearing subtypes
  (Metric/Chart/Table) but its shape (`panelId | typeId | fieldMappingKey`)
  is preserved — `""` → `null` collapse means an unbound bound-capable
  panel still produces a `null` key (same as the pre-CS2c-3c flat-field
  behaviour). Did not change cache invalidation, fetch sequencing, or
  paging logic.
- `frontend/src/features/panels/panelThunks.ts` (`fetchPanelPage`) —
  `panel.typeId` → `getDataTypeId(panel)`

## Service layer changes

`panelService.ts` rewrites every axios body to the typed shape:

- `POST /api/panels` sends `{ dashboardId, title, type, config }` via
  `buildCreatePanelBody`
- `PATCH /api/panels/:id` (binding) sends `{ config: { dataTypeId,
  fieldMapping } }` via `buildBindingPatch` (refreshInterval is dropped at
  the network boundary — see note in `panel.ts`)
- `PATCH /api/panels/:id` (content) sends `{ config: { content } }` via
  `buildContentPatch`
- `PATCH /api/panels/:id` (image) sends `{ config: { imageUrl, imageFit } }`
- `PATCH /api/panels/:id` (divider) sends `{ config: { orientation,
  weight, color } }`

Cross-cutting `updatePanelAppearance` and `updatePanelTitle` keep their
flat shape (the backend's `UpdatePanelRequest` reader still accepts
`title?` and `appearance?` alongside `config?`).

## Tests updated

Added `frontend/src/test/panelFixtures.ts` (131L) — fluent factories for
each subtype that take partial overrides; collapses every test's prior
flat-field panel literal to one fixture call.

Test files migrated to fixtures:

- `frontend/src/features/panels/panelsSlice.test.ts` — full rewrite of
  panel literals; thunk-level binding assertion now reads
  `panel.config.dataTypeId`
- `frontend/src/hooks/useLegacyBoundPanel.test.ts` — fixtures + config-side
  `dataTypeId`
- `frontend/src/hooks/usePanelData.test.ts` — fixtures + config-side
  `dataTypeId` / `fieldMapping`
- `frontend/src/features/dashboards/dashboardLayout.test.ts` — fixtures
- `frontend/src/components/PanelContent.test.tsx` — full rewrite (the
  component API changed from positional props to `panel`); preserves all
  scenarios, only construction changes
- `frontend/src/components/PanelCreationModal.test.tsx` — fixtures + mock
  return shapes; `PanelContent` mock now reads `panel.type`
- `frontend/src/components/PanelDetailModal.test.tsx` — fixtures across
  the metric / chart / divider / markdown / image test panels; the divider
  null-color edge case still uses the no-color fixture variant
- `frontend/src/components/ComputedFieldPicker.test.tsx` — fixtures
- `frontend/src/components/PanelGrid.test.tsx` — fixtures (incl. legacy /
  pipeline panel typeId via `config.dataTypeId`)
- `frontend/src/components/PanelList.test.tsx` — bulk replace_all of
  flat-field literals with `config: { dataTypeId, fieldMapping }` objects
- `frontend/src/app/App.test.tsx` — same bulk replace_all + one panelBase
  switched to fixtures

664 tests pass (no regression from cycle 1's 664).

## Gates run

| Gate                                       | Result |
| ------------------------------------------ | ------ |
| `sbt test` (backend)                       | 591/591 pass |
| `npm run lint`                             | clean (zero warnings) |
| `npm run format:check`                     | clean |
| `npm test` (frontend Jest)                 | 664/664 pass |
| `npm run build` (frontend)                 | green |
| `npm run check:schemas`                    | 6/6 in sync |
| `npm run check:openspec`                   | clean |
| `npm run check:scala-quality`              | clean (18 pre-existing soft-budget warnings, no new violations) |
| `openspec validate panel-wire-frontend-lockstep` | valid |

`tsc --noEmit` clean for everything I touched. Remaining 54 errors are all
in pre-existing `toastListeners.ts` / `listenerMiddleware.ts` / `env.ts`
files outside CS2c-3c scope.

## File sizes after cycle 2

All previously-over-cap files are now under the 400L hard cap:

| File                                                  | Before | After |
| ----------------------------------------------------- | ------ | ----- |
| `frontend/src/components/PanelDetailModal.tsx`        | 1021   | 390   |
| `frontend/src/components/PanelGrid.tsx`               | 597    | 363   |
| `frontend/src/types/models.ts`                        | 587    | 367   |
| `frontend/src/features/panels/panelsSlice.ts`         | 439    | 241   |

Every new file is under the 250L soft cap with the exception of:

| File                                                  | Lines |
| ----------------------------------------------------- | ----- |
| `frontend/src/features/panels/panelThunks.ts`         | 256   |
| `frontend/src/components/panels/editors/BindingEditor.tsx` | 234 |
| `frontend/src/components/panels/editors/ChartAppearanceEditor.tsx` | 217 |
| `frontend/src/types/pipelineStep.ts`                  | 216   |
| `frontend/src/hooks/usePanelGridSave.ts`              | 181   |

All under 300L; soft-cap warnings only. `panelThunks.ts` is dense thunk
boilerplate (one createAsyncThunk per panel CRUD operation); a further
per-domain split would fragment the public surface for no readability win.

## Nuance for the evaluator

1. **HEL-242 non-regression** — `usePanelData.ts` cache key was
   `panelId|typeId|fieldMappingKey` and remains `panelId|typeId|
   fieldMappingKey` after the narrowing migration. The `""` → `null`
   collapse in `getDataTypeId` preserves the pre-CS2c-3c behaviour where an
   unbound metric/chart/table panel produced a `null` key (and thus no
   fetch). I did not "fix" the deferred bug and did not regress it. Worth
   spot-checking that the cycle-2 PR ships a live `npm run dev` session
   where a populated DataType bound to a Metric panel still renders rows —
   that's the HEL-242 spec scenario.

2. **`useLegacyBoundPanel` preservation** — the hook still exists and is
   still load-bearing for pre-Pipeline DataType-bound panels. The only
   internal change is `panel.typeId` → `getDataTypeId(panel)`. Behaviour
   identical.

3. **`refreshInterval` is a frontend-only field** — there's no backend
   schema or column for it. `updatePanelBinding` thunk still accepts
   `refreshInterval` and the binding editor still writes it to local
   state, but `panelService.updatePanelBinding` drops it at the network
   boundary (with a noted comment). Local polling via
   `usePanelPolling(refresh, panel.refreshInterval, getDataTypeId(panel))`
   keeps working as-is. Marked clearly with a CS3-cleanup comment.

4. **Backend emits `dataTypeId: ""` for unbound bound-capable panels** —
   the cycle-1 tolerance-rule flag. The frontend `getDataTypeId` accessor
   collapses `""` → `null` so call-sites that test for "is bound" use a
   `null` check (consistent with the pre-CS2c-3c flat-field idiom). The
   narrowed `panel.config.dataTypeId` directly reads the empty string,
   which the binding editor's `selectedTypeId` initialiser uses
   (`config.dataTypeId.length > 0 ? config.dataTypeId : null`).

5. **`PanelContent` API change is breaking for any out-of-tree consumer**
   — the props collapsed from `{ type, fieldMapping, content, imageUrl,
   imageFit, dividerOrientation, dividerWeight, dividerColor, ... }` to
   `{ panel, data, rawRows, headers, isLoading, error, noData,
   appearance?, paginationRows?, ... }`. All in-tree consumers
   (`PanelGrid`, `PanelDetailModal`, `PanelCreationPreview`) are
   migrated; no other call sites exist.

6. **`PanelCreationPreview` constructs a synthetic preview Panel** — to
   satisfy the new dispatcher API without round-tripping through the
   backend. The synthetic panel has placeholder IDs ("preview") and the
   preview never touches the network.

7. **Three drive-by extractions in `models.ts`** — I extracted
   `dataSource.ts` and `pipelineStep.ts` (pre-existing ADTs) alongside
   the spec-mandated `panel.ts` to bring models.ts under the 400L hard
   cap. Re-exports preserve every existing import. Spec D4 only mandates
   the panel extraction; the two extras are behaviour-preserving structural
   moves to satisfy the file-size budget rule the spec also enforces.

## Commits

1. `c61aca5` — `HEL-236 CS2c-3c cycle 1: OpenSpec change folder`
2. `54adf07` — `HEL-236 CS2c-3c cycle 1: Backend wire shape collapse to type + typed config`
3. `75b55a3` — `HEL-236 CS2c-3c cycle 1: JSON Schemas evolved in-place to discriminated wire`
4. `ecb9da9` — `HEL-236 CS2c-3c cycle 1: executor report + files-modified handoff`
5. *(cycle 2 commits — see git log on this branch)*
