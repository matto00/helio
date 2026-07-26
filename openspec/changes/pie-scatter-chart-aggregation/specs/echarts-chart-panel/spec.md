## MODIFIED Requirements

### Requirement: Chart panel renders a live ECharts instance
The system SHALL mount an ECharts chart inside any panel whose `type` is `"chart"`. The chart MUST fill the available panel card body area. When `fieldMapping.xAxis` and `fieldMapping.yAxis` are both set and data is available, the chart SHALL render a live series using the bound data; when fields are not mapped, the chart SHALL show an informative empty-state message ("Select fields to display chart data") rather than a blank canvas. If no field mapping is present, a placeholder chart SHALL be displayed defaulting to a line chart. When the panel's config carries a viz-level `aggregation` spec (`{ groupBy, agg, yField }`) and the rendered chart type is `bar`, `line`, or `pie`, the chart SHALL instead group rows by `groupBy` and render one aggregate mark per group (see `panel-viz-aggregation`), taking precedence over the raw `fieldMapping.xAxis`/`yAxis` per-row rendering for that render. For `pie`, the aggregate renders as one `{name, value}` slice per group instead of the bar/line categories/values series shape. A `scatter`-typed chart never applies an `aggregation` spec even if one is present in config (backend validation prevents this combination from being written going forward; a legacy stored combination falls back to the existing raw-row scatter rendering).

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

#### Scenario: Aggregation spec takes precedence over per-row field mapping for bar/line/pie
- **WHEN** a bar-chart panel has both `fieldMapping.xAxis`/`yAxis` set AND a valid `aggregation` spec
- **THEN** the chart renders the grouped/aggregated series, not the raw per-row series

#### Scenario: Aggregation spec produces pie slices, not bar/line series data
- **WHEN** a pie-chart panel has a valid `aggregation` spec
- **THEN** the chart's rendered series is a pie series with one `{name, value}` datum per group,
  reshaped from the same categories/values aggregate bar/line consume

#### Scenario: A legacy stored scatter+aggregation combination still ignores the spec
- **WHEN** a scatter-chart panel has a stored `aggregation` spec (persisted before this behavior existed)
- **THEN** the chart falls back to its existing non-aggregated raw-point rendering path using
  `fieldMapping`, unchanged from before
