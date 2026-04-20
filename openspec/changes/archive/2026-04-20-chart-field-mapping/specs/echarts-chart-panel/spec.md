## MODIFIED Requirements

### Requirement: Chart panel renders a live ECharts instance
The system SHALL mount an ECharts chart inside any panel whose `type` is `"chart"`, replacing the
previous static bar-chart skeleton. The chart MUST fill the available panel card body area. When
`fieldMapping.xAxis` and `fieldMapping.yAxis` are both set and data is available, the chart SHALL
render a live series; when fields are not mapped, the chart SHALL show an informative empty-state
message ("Select fields to display chart data") rather than a blank canvas.

#### Scenario: Chart panel mounts an ECharts instance
- **WHEN** a panel with `type: "chart"` is displayed in the grid
- **THEN** an ECharts canvas element is rendered inside the panel card body

#### Scenario: Unbound chart panel shows an empty default chart
- **WHEN** a panel with `type: "chart"` has no data bound (`typeId` is absent)
- **THEN** an empty line chart with placeholder axes is displayed (no data series, no error state)

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
