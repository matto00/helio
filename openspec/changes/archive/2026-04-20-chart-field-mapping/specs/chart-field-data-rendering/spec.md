## ADDED Requirements

### Requirement: ChartPanel renders data from fieldMapping and rawRows
The ChartPanel component SHALL accept `rawRows`, `headers`, and `fieldMapping` props. When `fieldMapping.xAxis` and `fieldMapping.yAxis` are both set, the component SHALL build an ECharts `series` using the corresponding columns and render a line chart with the xAxis categories and yAxis values.

#### Scenario: Chart renders with mapped xAxis and yAxis
- **WHEN** a chart panel has `fieldMapping = { xAxis: "date", yAxis: "price" }` and `rawRows` contains data
- **THEN** an ECharts chart is displayed with the "date" column as x-axis categories and the "price" column as y-axis values

#### Scenario: Chart renders multiple rows as a data series
- **WHEN** `rawRows` has more than one row and xAxis/yAxis fields are mapped
- **THEN** all rows are represented in the rendered series (not just the first row)

#### Scenario: Mapped field not present in headers produces empty series
- **WHEN** `fieldMapping.yAxis` refers to a field name not in `headers`
- **THEN** the chart renders with an empty series (no crash, no error state)

### Requirement: ChartPanel shows an empty state when fields are not mapped
When `fieldMapping.xAxis` or `fieldMapping.yAxis` is absent or empty, the ChartPanel SHALL display an informative message ("Select fields to display chart data") in place of the ECharts canvas.

#### Scenario: No xAxis mapping shows empty state
- **WHEN** `fieldMapping` has no `xAxis` key (or it is empty string)
- **THEN** the panel body shows "Select fields to display chart data" text instead of a chart

#### Scenario: No yAxis mapping shows empty state
- **WHEN** `fieldMapping` has no `yAxis` key (or it is empty string)
- **THEN** the panel body shows "Select fields to display chart data" text instead of a chart

#### Scenario: Null fieldMapping shows default placeholder chart
- **WHEN** the panel has no `fieldMapping` (panel is unbound or fieldMapping is null)
- **THEN** the existing empty placeholder ECharts chart is shown (no error, no empty-state text)
