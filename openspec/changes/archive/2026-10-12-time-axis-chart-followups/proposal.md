## Why

HEL-1305 gave timestamp-typed x fields a real time axis, and left four rough edges behind. On a raw-row single-series bar chart, two rows that share a date draw on top of each other and the smaller value is hidden. Rows whose x value isn't a date are dropped without any sign. A non-numeric y draws as a real 0 on single-series and auto-detect charts, but as a gap on multi-series ones. And the older spec text still says the x field is always rendered as categories. The owner settled the product calls on 2026-10-12 (ticket.md "Owner rulings").

## What Changes

- **Same-date bars (ruling Q1: category-fallback).** A raw-row bar chart with one point per row (single-series, or auto-detect with no y mapping) whose x field qualifies for a time axis falls back to a category axis when any two plotted rows denote the same instant. On that axis every row keeps its own bar, ordered by instant. Line, scatter, multi-series and aggregated charts are unchanged.
- **Dropped-rows note.** A chart that plots on a time axis and leaves out rows (or aggregate groups) whose x denotes no instant shows a footnote such as "3 rows with no readable date not shown." The note has the same style and slot as the histogram's skipped-values note.
- **Non-numeric y is a gap (ruling Q2: gap-everywhere).** Single-series and auto-detect line/bar charts plot a non-numeric or empty y as `null` on both category and time axes, the same as multi-series charts: a line breaks there and no bar is drawn. A scatter point with no numeric y is not drawn. A single-series gap draws no mark, so it has no hover target; the `—` appears only in tooltips that list a missing value (multi-series axis tooltips).
- **No axis-type override (ruling Q3: no-override).** No setting is built. The spec states that a pipeline cast to `timestamp` is how a string column gets a time axis.
- **Spec cross-reference.** The older "ChartPanel renders data from fieldMapping and rawRows" requirement, which says the x column renders as categories, now points to the time-axis requirement and the new gap rule.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `chart-field-data-rendering`: the categories requirement gains a cross-reference to the time-axis requirement. The time-axis requirement gains same-instant bar fallback, the dropped-rows note, and the cast-to-timestamp path. The gap rule widens from multi-series to every line/bar/scatter series.

## Impact

- Frontend only, with no API, schema or backend change. Files: `frontend/src/features/panels/ui/chartDataOptions.ts`, `chartTimeDataOptions.ts`, `renderers/ChartRenderer.tsx` (note), `buildChartOption.ts` (lines ~137-158 replaced by the shared resolver call), an echarts-free helper for the dropped count (in `frontend/src/utils/chartTimeAxis.ts` or a sibling), and their tests. Existing tests that pin NaN -> 0 on single-series (e.g. `buildChartOption.unchangedPath.test.ts`) change on purpose.
- Visible change: single-series charts with non-numeric y cells now show gaps where they showed 0.
- e2e: `e2e/hel1305-chart-time-axis.spec.ts` may gain cases. hel1306/hel1311/hel1512 must stay green.
