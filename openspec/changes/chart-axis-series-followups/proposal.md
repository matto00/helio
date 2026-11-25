## Why

HEL-1508 left four chart defects and two test gaps (see ticket.md): daily data gets hour ticks on a time axis,
duplicate x+series rows silently keep the last value, a non-time scatter plots a non-numeric x at 0, and an isolated
value between two gaps is invisible on a line with markers off.

## What Changes

- A time x axis never ticks finer than its data: whole-day data ticks at least a day apart (likewise whole hours,
  minutes, seconds).
- A multi-series line/bar sums the numeric y of rows that share an x (or instant) and series, and footnotes how many
  rows were added to another, on category and time axes.
- A non-time scatter draws no point for a row whose x is not numeric, and footnotes how many rows were left out.
- A line with markers off shows a marker on a value whose neighbours are both gaps (or absent).
- Chart footnotes that apply together render on one line.
- Tests: a labelled GUARD case for an {xAxis, series} mapping with no yAxis; a positive control for hel1508's empty
  gap tooltip e2e check.

## Non-goals

- The `buildChartOption.ts` compact-mode split (item 6): items 1-4 do not touch that file's compact pass, so it is
  left and raised as a follow-up triage.
- No change to aggregated charts' values, pie, heatmap, histogram, or the silent no-point rule for a non-numeric
  scatter y.
- No backend, schema or migration change.

## Capabilities

### New Capabilities

### Modified Capabilities
- `chart-field-data-rendering`: time-axis tick floor, duplicate x+series summing with a footnote, scatter non-numeric
  x exclusion with a footnote, isolated-point markers.

## Impact

Frontend only: `frontend/src/features/panels/ui/buildChartOption.ts`, `chartDataOptions.ts`, `chartTimeDataOptions.ts`,
`echartsCore.ts` (register `MarkPointComponent`), `frontend/src/utils/chartTypeOptions.ts`, `frontend/src/utils/chartTimeAxis.ts`,
a new `frontend/src/utils/chartSeriesNotes.ts`, `renderers/ChartRenderer.tsx`, their tests, `e2e/hel1508-chart-time-axis-followups.spec.ts` and a new `e2e/hel1517-chart-followups.spec.ts`.
