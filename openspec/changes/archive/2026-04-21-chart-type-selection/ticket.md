# HEL-72: Chart panel: chart type selection (bar, line, pie, scatter)

## Context

Chart panels currently hard-code `type: "bar"` for all series. Users should be able to choose the chart type that best fits their data. Discovered as a gap during HEL-68 manual testing.

## What changes

### Backend / schema

* Add `chartType` field to `ChartAppearance` (alongside existing `seriesColors`, `legend`, `tooltip`, `axisLabels`)
* Supported values: `"bar"` | `"line"` | `"pie"` | `"scatter"`
* Default: `"bar"`
* Persisted as part of the panel appearance JSON blob — no migration needed

### Frontend

* Add a chart type selector to the Appearance tab of the panel detail modal (radio buttons or a segmented control)
* `ChartPanel` passes the selected `chartType` to each ECharts series entry
* Pie charts require special handling: no x/y axes, series `data` is `[{ name, value }]` built from the field mapping
* Live preview in the modal updates as the user switches type
* `appearanceToEChartsOption` in `chartAppearance.ts` extended to include `chartType`

## Acceptance criteria

- [ ] Users can select bar, line, pie, or scatter chart type from the Appearance tab
- [ ] The panel updates immediately without requiring a save
- [ ] Pie chart renders correctly using the mapped x (label) and y (value) fields
- [ ] Scatter chart renders correctly using x and y field mappings as coordinates
- [ ] Selected chart type persists across page reloads
- [ ] Switching type in the modal preview reflects the change before saving
