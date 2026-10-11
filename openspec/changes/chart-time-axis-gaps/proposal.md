## Why

A chart over dates plots irregularly spaced days evenly (every cartesian chart uses a category x axis), and a
multi-series chart plots a missing point as 0, which reads as a real zero. helio-news had to gap-fill days in
Python to get an honest CI-health trend. See ticket.md (HEL-1305) and its owner rulings 1-5.

## What Changes

- A chart whose x field is declared `timestamp` in the Output's schema renders an ECharts `time` x axis: points
  sorted by instant, spaced proportionally, labels and tooltips in UTC (ruling 1, 3, 4). Applies to line,
  vertical bar and scatter, on raw-row and aggregated (grouped-by-timestamp) Outputs (ruling 5).
- A multi-series chart plots `null` (a line gap, no bar) where a series has no value at an x, on category and
  time axes alike, instead of 0 (ruling 2).
- The "vs" compare overlay keeps working on a time axis, aligned to the primary points by instant (ruling 5).
- Reference lines/bands, horizontal bars, pie, heatmap, histogram and every non-timestamp x field are unchanged.
- No new config key, no backend API change, no migration.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `chart-field-data-rendering`: adds the time-axis rule for timestamp x fields and the multi-series gap rule.
- `chart-history-overlay`: the overlay requirement accepts a time x axis (alignment by instant) in addition to a
  category axis.

## Impact

- Frontend only: `frontend/src/features/panels/ui/chartDataOptions.ts`, `buildChartOption.ts`,
  `chartOverlayOption.ts`, `useChartOption.ts`, `ChartPanel.tsx`, `renderers/ChartRenderer.tsx`,
  `ChartOutputPanel.tsx`, `OutputPanelContent.tsx`, the editor preview (`OutputPreviewPane.tsx`), the history
  chart (`HistoryChart.tsx`), `utils/chartTypeOptions.ts` (normalized stacking reads pair data),
  `utils/chartClickSelection.ts` (click keys on a time axis), a new echarts-free `utils/chartTimeAxis.ts`.
- Backend: test-only — a parity spec reading a shared timestamp fixture against `TimestampParsing.parseInstant`.
- No schema/config/API change, so no seam test of a config contract is needed; the cross-layer contract that
  does exist (what a timestamp value means) is pinned by the shared fixture.
