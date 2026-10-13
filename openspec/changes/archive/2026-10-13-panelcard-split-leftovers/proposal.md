## Why

HEL-1365 split `PanelCard.tsx` into `PanelCardHeader`/`PanelCardBody`/`usePanelCardInspect` but left its 807-line test
file whole, left a never-rendered chart-appearance editor behind `showChartSection={false}`, and left spec and comment
pointers to code that has moved. Re-derived against origin/main 290ab8a22; every item still holds (see
`premise-validation.md` in the run evidence), two with drifted locations.

## What Changes

- Split `frontend/src/features/panels/ui/PanelCard.test.tsx` (807 lines, 36 tests) into focused files by the module
  each block exercises. Same 36 test names, same bodies; only moves, shared-preamble duplication and imports.
- Remove the dead chart-appearance path from the panel detail modal: `ChartAppearanceEditor.tsx` (never rendered), the
  `showChartSection`/`chartAppearance`/`setChartAppearance` props of `AppearanceEditor`, the `chartAppearance` edit
  state and `buildInitialChart` (feeds only that editor; the save path never reads it), and CSS rules only it used.
- Retire the two HEL-1378 tests that assert the prop handed to the deleted editor; keep the save-payload guard test.
- Fix stale pointers: the chart-type-config-editor spec's "Appearance section's chart type selector" (now the Output
  editor's selector), `PanelCard.crossFilter.test.tsx:162` (`filteredPaginationRows` is in `OutputPanelContent.tsx`),
  `usePanelSortFilter.ts:79` (`useOutputMeta` is `PanelCardBody`'s), and `ChartDisplayFields.tsx`'s header comment.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `chart-type-config-editor`: the Display section swaps with the Output editor's chart type selector, not a panel
  Appearance-section selector that no longer exists. Wording-only sync to shipped behaviour.

## Impact

Frontend only: `features/panels/ui/` tests, `editors/AppearanceEditor.tsx`, `editors/ChartAppearanceEditor.tsx`
(deleted), `detailModal/` edit state and CSS, one spec. No API, schema, backend or user-visible change.

## Non-goals

- Re-auditing the rest of `chart-type-config-editor` (its dirty/save and mobile requirements still name the panel edit
  pane); filed as a follow-up if confirmed stale.
- Splitting `PanelContent.tsx`/`PanelDetailModal.tsx` (HEL-1399).
- Any change to chart rendering or chart-type resolution.
