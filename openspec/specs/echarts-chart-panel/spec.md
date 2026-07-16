# echarts-chart-panel Specification

## Purpose
Defines the ECharts-based chart panel that renders inside any panel with `type: "chart"`. Covers mounting, resizing, empty states, chart type rendering, and clean disposal.
## Requirements
### Requirement: Chart panel renders a live ECharts instance
The system SHALL mount an ECharts chart inside any panel whose `type` is `"chart"`. The chart MUST fill the available panel card body area. When `fieldMapping.xAxis` and `fieldMapping.yAxis` are both set and data is available, the chart SHALL render a live series using the bound data; when fields are not mapped, the chart SHALL show an informative empty-state message ("Select fields to display chart data") rather than a blank canvas. If no field mapping is present, a placeholder chart SHALL be displayed defaulting to a line chart. When the panel's config carries a viz-level `aggregation` spec (`{ groupBy, agg, yField }`) and the rendered chart type is `bar` or `line`, the chart SHALL instead group rows by `groupBy` and render one aggregate mark per group (see `panel-viz-aggregation`), taking precedence over the raw `fieldMapping.xAxis`/`yAxis` per-row rendering for that render.

#### Scenario: Chart panel mounts an ECharts instance
- **WHEN** a panel with `type: "chart"` is displayed in the grid
- **THEN** an ECharts canvas element is rendered inside the panel card body

#### Scenario: Chart panel renders the stored chart type
- **WHEN** a panel with `type: "chart"` has `appearance.chartType` set to a supported type
- **THEN** the ECharts instance renders that chart type (e.g. bar renders a bar chart)

#### Scenario: Unbound chart panel shows an empty default chart
- **WHEN** a panel with `type: "chart"` has no data bound (`typeId` is absent)
- **THEN** an empty chart with placeholder axes is displayed using the selected chart type (or line if unset)

#### Scenario: Chart panel with unknown chartType falls back to line
- **WHEN** a panel with `type: "chart"` has an unrecognised `appearance.chartType` value
- **THEN** a line chart is rendered without error

#### Scenario: Bound chart panel with no field mapping shows empty state message
- **WHEN** a panel with `type: "chart"` is bound to a DataType but `fieldMapping` has no xAxis or yAxis
- **THEN** the panel body shows "Select fields to display chart data" instead of a blank canvas

#### Scenario: Chart fills the panel card body
- **WHEN** a chart panel is rendered
- **THEN** the ECharts canvas fills 100% of the available card body height and width

#### Scenario: No console errors on mount
- **WHEN** a chart panel mounts
- **THEN** no JavaScript errors or warnings are emitted to the console

#### Scenario: No console errors on unmount
- **WHEN** a chart panel is removed from the grid (panel deleted or dashboard changed)
- **THEN** the ECharts instance is disposed cleanly with no console errors

#### Scenario: Aggregation spec takes precedence over per-row field mapping for bar/line
- **WHEN** a bar-chart panel has both `fieldMapping.xAxis`/`yAxis` set AND a valid `aggregation` spec
- **THEN** the chart renders the grouped/aggregated series, not the raw per-row series

### Requirement: Chart panel resizes with the grid panel
The ECharts instance MUST reflow to match the panel card dimensions whenever the panel is resized
on the dashboard grid.

#### Scenario: Chart resizes when panel is resized
- **WHEN** the user drags a chart panel's resize handle to a new size
- **THEN** the ECharts canvas updates its dimensions to fill the new panel size without overflow or blank space

### Requirement: Chart appearance is settable through the dashboard-proposal apply path
`POST /api/dashboards/apply-proposal` SHALL accept, per chart panel, optional `chartType`
(`bar`|`line`|`pie`|`scatter`), `xAxisLabel`, `yAxisLabel` (strings), and `seriesColors` (array of CSS
color strings). When any of these are present, the created panel's `appearance.chart` SHALL be set to
reflect them (defaulting unspecified sub-fields the same way the manual chart-appearance editor does)
so the panel renders with that chart type/axes/colors immediately, without a follow-up manual edit.
Applying a proposal that omits all chart-appearance fields for a chart panel SHALL leave that panel's
appearance at the default (today's behavior: a line chart with unset axis titles).

#### Scenario: Proposal-created bar chart applies with its chart type and axis titles
- **WHEN** a dashboard proposal's chart panel specifies `chartType: "bar"`, `xAxisLabel: "Rating"`,
  `yAxisLabel: "Count"`
- **THEN** the applied panel's `appearance.chart.chartType` is `"bar"` and `axisLabels.x.label`/
  `axisLabels.y.label` are `"Rating"`/`"Count"`

#### Scenario: Proposal-created chart with series colors applies those colors
- **WHEN** a dashboard proposal's chart panel specifies `seriesColors: ["#ff0000", "#00ff00"]`
- **THEN** the applied panel's `appearance.chart.seriesColors` includes those values

#### Scenario: Proposal chart panel with no appearance fields keeps default appearance
- **WHEN** a dashboard proposal's chart panel specifies no `chartType`/axis/`seriesColors` fields
- **THEN** the applied panel's `appearance.chart` is unset (renders as today's default line chart)

#### Scenario: An invalid chartType is rejected before anything is created
- **WHEN** `POST /api/dashboards/apply-proposal` is called with a chart panel's `chartType` set to a
  value outside `bar|line|pie|scatter`
- **THEN** the response is 400 and no dashboard or panel is created

### Requirement: Chart panel applies persisted per-type display options
The chart panel SHALL apply `config.chartOptions` entries for the active chart type
(`appearance.chart.chartType`, default `line`) to the rendered ECharts option via real ECharts
constructs:
- Line: `smooth` → `series.smooth`; `showPoints` → `series.showSymbol`; `areaFill` → `series.areaStyle`.
- Bar: `orientation: "horizontal"` → category/value axis roles swapped; `stacking: "stacked"` →
  `series.stack`; `stacking: "normalized"` → `series.stack` plus per-category percent-share values with a
  0–100 "%" value axis; `barGapPct` → `series.barCategoryGap`.
- Pie: `donutHolePct` → `series.radius: [<hole>%, <outer>%]`; `showPercentLabels` → `series.label` with a
  percentage formatter.
- Scatter: `sizeField` → a third data dimension driving `series.symbolSize`; `colorField` → one series
  per distinct field value with legend entries.

Options stored under other chart types MUST NOT affect the render. Entries absent within the active
type's options fall back to the current defaults. The aggregate render path (bar/line) MUST apply the
same active-type options. Mobile `compact` behavior (HEL-301) is unchanged and applied after options.

#### Scenario: Line options render
- **WHEN** a line chart panel has `chartOptions.line = { smooth: true, showPoints: false, areaFill: true }`
- **THEN** the built ECharts series has `smooth: true`, `showSymbol: false`, and an `areaStyle`

#### Scenario: Horizontal stacked bars render
- **WHEN** a bar chart panel has `chartOptions.bar = { orientation: "horizontal", stacking: "stacked" }`
- **THEN** the category axis is the y-axis and every series carries the same `stack` value

#### Scenario: Normalized stacking renders percent shares
- **WHEN** a bar chart panel has `chartOptions.bar.stacking = "normalized"` with multiple series
- **THEN** each category's rendered values sum to 100 and the value axis is labeled as percentages

#### Scenario: Donut with percentage labels renders
- **WHEN** a pie chart panel has `chartOptions.pie = { donutHolePct: 50, showPercentLabels: true }`
- **THEN** the pie series has a non-zero inner radius and labels including the `{d}` percentage

#### Scenario: Scatter size and color fields render
- **GIVEN** a bound scatter panel with `chartOptions.scatter = { sizeField: "population", colorField: "region" }`
- **WHEN** the chart renders
- **THEN** symbol sizes vary with the size field and one legend/series entry exists per distinct region

#### Scenario: Inactive type's options are ignored
- **WHEN** a line chart panel also has `chartOptions.pie` stored
- **THEN** the rendered line chart is unaffected by the pie entry

