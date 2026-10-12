## Why

HEL-1311 shipped heatmap and histogram charts with five polish defects (HEL-1487): ECharts' automatic interval hides
every other category label even when all would fit, histogram bin labels mix decimal precision ("0 to 2.5", "2.5 to
5"), the heatmap editor hint contradicts the summing behaviour, two source comments enumerate a stale chart-type set,
and an e2e touch-target check was loosened to 43px because it measured mid-animation.

## What Changes

- Heatmap category axes (columns and rows) and the histogram category x axis show every label when they fit and hide
  overlapping labels when they do not, instead of ECharts' automatic every-other interval.
- Histogram bin range labels use one decimal-place count for the whole chart, chosen from the bin edges.
- The heatmap Output-editor aggregation hint states that rows sharing a column and row are summed into one cell.
- Comments in `ChartPanel.tsx` and `chartOverlayOption.ts` are corrected for the current chart-type set.
- The HEL-1311 e2e spec waits for the editor sheet's animation to settle before measuring and restores the 43.5px
  threshold; its legend probe names the ECharts version whose internals it reads.

## Capabilities

### New Capabilities

### Modified Capabilities
- `heatmap-histogram-charts`: histogram bin labels gain a consistent-precision rule; heatmap/histogram category axes
  gain a show-every-label-that-fits rule; the heatmap editor hint must describe summing.

## Non-goals

- No change to line, bar, pie or scatter axes, nor to HEL-1305's time-axis `hideOverlap` or HEL-1306 reference marks.
- No change to binning itself (edges, counts, bin-count rule) or to the tooltip number format of other charts.
- No label rotation or truncation feature; no new design tokens.

## Impact

- `frontend/src/features/panels/ui/heatmapHistogramOptions.ts`, `buildChartOption.ts` (axis label merge paths only if
  needed), `ChartPanel.tsx`, `chartOverlayOption.ts` (comments).
- `frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx` and its heatmap/histogram test.
- `e2e/hel1311-heatmap-histogram-charts.spec.ts`. No backend, schema or API change.
