## Context

`ChartPanel` is a React component backed by `echarts-for-react`. It currently renders a static placeholder with empty axes and no series. The data-fetch pipeline (`usePanelData`) already returns `rawRows: string[][]`, `headers: string[]`, and the panel's `fieldMapping` is available on the `Panel` model. `PanelContent` receives all of these but passes nothing to `ChartPanel`. This design bridges that gap with a pure frontend prop-threading change.

## Goals / Non-Goals

**Goals:**
- Make `ChartPanel` accept `rawRows`, `headers`, and `fieldMapping` and transform them into an ECharts series option
- Show an informative empty state when xAxis or yAxis fields are not mapped
- Keep all existing empty-chart behaviour for unbound panels (no `typeId`)

**Non-Goals:**
- Changing the data-fetch or backend APIs
- Chart type selection, color palette, or tooltip customization
- Series grouping beyond a single yAxis column mapped as a single series

## Decisions

**D1 — Prop-thread `fieldMapping` from `PanelCardBody` through `PanelContent` to `ChartPanel`.**
`PanelCardBody` already has the `Panel` object; it passes `panel.fieldMapping` as a new prop to
`PanelContent`, which forwards it to `ChartPanel`. This avoids reaching for a hook or context and
keeps the data flow explicit and testable.

Alternative considered: pass `fieldMapping` via a context. Rejected — context adds indirection
without benefit for a single consumer.

**D2 — `ChartPanel` transforms `rawRows`/`headers` to ECharts `series` format inline.**
The transform is a small mapping: find column indices for xAxis and yAxis fields in `headers`, then
map each row to a `[xVal, yVal]` pair. This stays inside `ChartPanel` rather than being lifted to
`usePanelData`, keeping chart-specific concerns local.

The `series` slot from `fieldMapping` is reserved but not yet implemented for multi-series grouping
(non-goal). A single `line` series using the yAxis field name as its label is rendered.

**D3 — Empty state when xAxis or yAxis is not mapped.**
If `fieldMapping.xAxis` or `fieldMapping.yAxis` is absent, `ChartPanel` renders a `<div>` with
"Select fields to display chart data" instead of an empty ECharts canvas, matching the pattern used
by `MetricContent` and `TextContent` for unbound states.

## Risks / Trade-offs

- [Risk] Column name mismatch between `headers` and `fieldMapping` values yields an empty series
  silently. → Mitigation: the empty state already covers "no data" via the `noData` prop; a column
  miss produces an empty series which ECharts renders as a blank chart (acceptable).

## Planner Notes

- Self-approved: purely additive frontend prop threading, no new external deps, no API changes.
- The existing `echarts-chart-panel` spec's "Unbound chart panel shows an empty default chart"
  scenario remains valid; the modified spec in this change adds the new "unmapped fields" case.
