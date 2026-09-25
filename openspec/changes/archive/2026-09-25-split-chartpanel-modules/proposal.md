## Why

`ChartPanel.tsx` (590 lines) and `ChartPanel.test.tsx` (1110 lines) are well past
CONTRIBUTING.md's ~400-line propose-a-split threshold. HEL-572 already peeled off
the reusable pure click-selection logic (`chartClickSelection.ts`); the
option-assembly `useMemo` is now the largest remaining block. Splitting now, before
HEL-588 (cross-filtering) also touches these files, keeps HEL-588 landing in
smaller, single-concern files — an owner ruling (2026-09-25, HEL-1180 now `blocks`
HEL-588 in Linear).

## What Changes

- Split `ChartPanel.tsx`'s pure data-option-assembly logic (`buildDataOption`,
  `buildDataOptionCore`, `buildAggregateDataOption`, `withPointerCursor`) into a new
  pure module, `chartDataOptions.ts`.
- Split the appearance+data+compact merge logic (the current `useMemo` body, minus
  its React-hook cache-busting) into a new pure module, `buildChartOption.ts`.
- Extract the theme-sync state/effect + memoization into a new hook,
  `useChartOption.ts`.
- Extract click-event wiring (`EChartsClickEventParams`, click handler, `onEvents`
  memo) into a new hook, `useChartClickHandler.ts`.
- `ChartPanel.tsx` shrinks to: props, layout/measurement wiring, and calling the two
  new hooks + rendering `ReactECharts`.
- Split `ChartPanel.test.tsx` by concern into `ChartPanel.test.tsx` (data-option
  assembly: no-data/mapped/auto-detect/pie/scatter/F-027 regression),
  `ChartPanel.appearance.test.tsx` (appearance + HEL-248 `chartOptions`),
  `ChartPanel.aggregate.test.tsx` (HEL-292/HEL-624 `chartAggregate`),
  `ChartPanel.compact.test.tsx` (HEL-301/F-028/F-094 compact-mode), and
  `ChartPanel.theme.test.tsx` (HEL-566 tooltip/hover + the theme/accent-toggle
  no-remount regression). `ChartPanel.click.test.tsx` (HEL-572) is untouched.
  Shared `renderChart`/`getOption` test helpers move to
  `chartPanelTestHelpers.tsx`; each test file keeps its own `jest.mock(...)` calls
  (Jest hoists mocks per-file — they cannot live in a shared imported helper).
- No behavior change. No new tests beyond what already exists (assertion count and
  substance preserved; only file location changes).

## Capabilities

### New Capabilities

None — pure internal structural refactor, no capability/spec-level behavior change.
`skip_specs: true` set in `.openspec.yaml`.

### Modified Capabilities

None.

## Impact

- Affected: `frontend/src/features/panels/ui/ChartPanel.tsx`,
  `ChartPanel.test.tsx`, and their new sibling files listed above. No import-site
  changes outside this directory — `ChartPanel`'s public export (name, props,
  default export shape) is unchanged, so `PanelCard.tsx` /
  `PanelFullscreenOverlay.tsx` and any other consumer need no edits.
- No API, schema, or migration impact (pure frontend refactor).

## Non-goals

- No fix for HEL-1178 (charts with no `appearance.chart` get `{}` appearance) or
  HEL-1179 (`prefersReducedMotion` consolidation) — both are separately filed,
  behavior-changing follow-ups, explicitly out of scope here.
- No HEL-588 (cross-filter) behavior pre-built into the new seams.
