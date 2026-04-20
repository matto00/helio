# HEL-67: Chart panel: field mapping to axes and series

## Context

Chart panels are bound to a DataType via the existing panel ↔ DataType binding (HEL-49). This ticket maps those bound fields to ECharts axes and series so the chart renders real data.

## What changes

* In the panel detail modal (Data or Chart tab), add field mapping controls: X axis, Y axis, and optional series grouping
* Dropdowns are populated from the bound DataType's fields
* The chart re-renders with real data from the bound DataSource when fields are mapped
* Mapping config is persisted to the panel's `fieldMapping` (extend existing schema if needed)
* Handles missing or mismatched field types gracefully (empty state, not crash)

## Acceptance criteria

- [ ] A chart panel with a bound DataType shows field selectors for X axis, Y axis, and series
- [ ] Selecting fields causes the chart to render the corresponding data from the bound source
- [ ] Field mapping is persisted and restored correctly across page reloads
- [ ] Unmapped fields result in an informative empty state, not an error
- [ ] Works correctly for at least line and bar chart types
