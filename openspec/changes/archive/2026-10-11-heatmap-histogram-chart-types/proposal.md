## Why

Real dashboards (helio-news CI Health: a test x day failure matrix, a job-duration distribution) need a heatmap and a
histogram, and both fell back to bar charts because `chartType` only allows bar/line/pie/scatter everywhere it is
enumerated (frontend, JSON schemas, backend validation, assistant/MCP enums).

## What Changes

- New chart Output `chartType` values `heatmap` and `histogram`, accepted by every write path, schema and enum that
  lists chart types today (Output config, panel appearance, dashboard proposals, assistant tool schema, MCP).
- Heatmap reuses the existing chart slots (owner ruling 2026-10-11, Q1=A): `xAxis` = column category, `series` = row
  category, `yAxis` = numeric value; duplicate cells are summed; rendered with a theme-token colour scale (visualMap).
- Histogram bins the numeric `xAxis` field into equal-width bins over [min, max]; bin count automatic (Sturges,
  clamped 1-50) unless `chartOptions.histogram.binCount` (integer 2-100) is set (Q2=A); non-numeric/blank cells are
  skipped and the skipped count is shown on the chart.
- `aggregation` is rejected on both types (like scatter); the Output editor hides the aggregation fields for them and
  shows per-type slot pickers (heatmap Columns/Rows/Value, histogram Field) plus a histogram bin-count control.
- Over the 200-row cap both types behave like other chart types, with the HEL-1358 note (Q3=A).
- No "vs" compare overlay, no click-to-select/Inspect from a click, and the History view shows a muted note instead
  of a chart for these types; history recording is unchanged (Q4=A).

## Capabilities

### New Capabilities
- `heatmap-histogram-charts`: rendering, data shapes, binning and editor controls for the heatmap and histogram types.

### Modified Capabilities
- `output-routes-api`: chartType accepts `heatmap`/`histogram`; aggregation rejected on them; binCount validated.
- `chart-history-overlay`: overlay ignored and Compare help text/note covers heatmap and histogram.
- `chart-drilldown-inspect`: clicks on heatmap/histogram elements select nothing.

## Non-goals

- Deciding HEL-1397 (how >200-row charts load/summarise); cell/bin click-to-select (follow-up ticket); user-set bin
  width; changing the stored history summary; threshold/reference lines (HEL-1306).

## Impact

Frontend chart rendering/registry/editor, `schemas/**` chart enums, backend `OutputConfigValidation`/`RequestValidation`/
assistant tool schema, `helio-mcp` enums and docs. Bundle grows by ECharts `HeatmapChart` + `VisualMapComponent`
(measured and noted in the PR). No migration.
