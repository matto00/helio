## Why

HEL-1311 shipped heatmap and histogram charts with polish defects (HEL-1487): histogram bin labels mix decimal precision ("0 to 2.5", "2.5 to
5"), the heatmap editor hint contradicts the summing behaviour, two source comments enumerate a stale chart-type set,
and an e2e touch-target check was loosened to 43px because it measured mid-animation.

## What Changes

- Histogram bin range labels use one decimal-place count for the whole chart, chosen from the bin edges.
- The heatmap Output-editor aggregation hint states that rows sharing a column and row are summed into one cell.
- Comments in `ChartPanel.tsx` and `chartOverlayOption.ts` are corrected for the current chart-type set.
- The HEL-1311 e2e spec waits for the editor sheet's animation to settle before measuring and restores the 43.5px
  threshold; its legend probe names the ECharts version whose internals it reads.

## Capabilities

### New Capabilities

### Modified Capabilities
- `heatmap-histogram-charts`: histogram bin labels gain a consistent-precision rule; heatmap/histogram category axes
  the heatmap editor hint must describe summing.

## Owner ruling: axis-label thinning is not changed

The original item 1 (show every heatmap/histogram axis label that fits) is out of scope; axis-label thinning stays
exactly as on main and the work is split to HEL-1512. ECharts' `interval: 0` + `hideOverlap` could not be made to
work well: its label collision boxes are measured from the glyph '国' (so stacked at 375 without a CJK font), and
the `textMargin` that fixes run-together labels re-thins labels that fit (see evaluation-4 and the skeptic-final
reports).

## Non-goals

- No change to heatmap/histogram axis-label thinning (HEL-1512).

- No change to line, bar, pie or scatter axes, nor to HEL-1305's time-axis `hideOverlap` or HEL-1306 reference marks.
- No change to binning itself (edges, counts, bin-count rule) or to the tooltip number format of other charts.
- No label rotation or truncation feature; no new design tokens.

## Impact

- `frontend/src/features/panels/ui/heatmapHistogramOptions.ts`, `buildChartOption.ts` (axis label merge paths only if
  needed), `ChartPanel.tsx`, `chartOverlayOption.ts` (comments).
- `frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx` and its heatmap/histogram test.
- `e2e/hel1311-heatmap-histogram-charts.spec.ts`. No backend, schema or API change.
