## Why

`PanelContent.tsx` (536 lines) and `PanelDetailModal.tsx` (589 lines) are past CONTRIBUTING.md's ~400-line "propose a
split" line. Each mixes several concerns: an output-kind dispatcher next to the generic state shell, and data wiring,
edit-form state, and per-kind editors in one component. Splitting them now, behaviour-preserving, is cheaper than after
the next feature lands in either file. The same pass folds in two test nits HEL-1378's reviewers left on
`PanelDetailModal.chartTypeDefault.test.tsx`.

## What Changes

- Move `OutputPanelContent` verbatim from `PanelContent.tsx` into `ui/OutputPanelContent.tsx`.
- Split `PanelDetailModal.tsx` into these pieces, all moved verbatim:
  - `OutputPanelSection.tsx`
  - `panelDetailChartState.ts` (`padSeriesColors`, `buildInitialChart`)
  - `usePanelDetailData` (viewer controls + Output meta + cross-filter + `usePanelData` + total row count)
  - `usePanelDetailEditState` (mode and edit-form state, editor refs, dirty tracking, reset)
  - `renderSubtypeEditor`
- Update import paths in importers and tests.
- Fix non-test source comments that point at the old locations (comment text only).
- HEL-1378 test nits: mock `listOutputPanels`/`getDistinctValues`, and render `AppearanceEditor` as JSX in
  `PanelDetailModal.chartTypeDefault.test.tsx`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a pure refactor (`skip_specs: true`).

## Non-goals

- Fixing anything found. Findings become follow-ups.
- HEL-1395's dead `ChartAppearanceEditor` chart-type section and `showChartSection` removal. It is noted, not absorbed.
- Editing comments in test files, apart from the folded-in nits.
- Trimming verbose comments inside moved code.

## Impact

Frontend only: `frontend/src/features/panels/ui/PanelContent.tsx`, `ui/detailModal/PanelDetailModal.tsx`, the new
modules, import lines in panel tests, and one test file (the nits). No API, schema, or CSS change.
