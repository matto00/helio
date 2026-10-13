# chart-field-data-rendering Specification

## Purpose
Maps DataType field names to ECharts axes and series so chart panels render real data from a bound DataType. Covers axis assignment, multi-row series, empty-state messaging, and null fieldMapping fallback.

## Requirements

### Requirement: ChartPanel renders data from fieldMapping and rawRows
The ChartPanel component SHALL accept `rawRows`, `headers`, and `fieldMapping` props. When `fieldMapping.xAxis` and `fieldMapping.yAxis` are both set, the component SHALL build an ECharts `series` using the corresponding columns and render a line chart with the xAxis categories and yAxis values. Rendering the x column as categories is the default; when the x field is declared `timestamp`, the axis is governed by "A timestamp x field renders on a time axis", and a y value that is not numeric is governed by "A chart shows a gap where a series has no numeric value".

#### Scenario: Chart renders with mapped xAxis and yAxis
- **WHEN** a chart panel has `fieldMapping = { xAxis: "date", yAxis: "price" }` and `rawRows` contains data
- **THEN** an ECharts chart is displayed with the "date" column as x-axis categories and the "price" column as y-axis values (or, when "date" is declared `timestamp`, on a time axis per "A timestamp x field renders on a time axis")

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

### Requirement: A timestamp x field renders on a time axis
When the field plotted on the x axis is declared `timestamp` in the Output's schema, a `line`, `scatter`, or
vertical `bar` chart (raw rows, or an aggregation grouped by that field) SHALL render a continuous time x axis:
points SHALL be ordered by the instant their x value denotes and spaced in proportion to the time between them.
An x value SHALL denote an instant exactly as the backend's shared timestamp parser reads it (see
`timestamp-value-parsing`), with no frontend-only extension: whole-number epochs (seconds, or milliseconds above
9999999999) whose instant lies in years 0001–9999, ISO instants and offset date-times, `T`- or space-separated date-times with a numeric offset
`+HH`/`+HHMM`/`+HH:MM`/`+HH:MM:SS` of at most 18:00 (either optionally followed by a bracketed id, read at the
written offset), time-zone-less date-times read as UTC, bare `yyyy-MM-dd` dates and
`MM/dd/yyyy` dates as midnight UTC. A row whose x value
denotes no instant SHALL NOT be plotted on the time axis; when one or more rows (or, for an aggregation, group
keys) are left out this way, the chart SHALL show a footnote stating how many, such as "3 rows with no readable
date not shown." or "1 group with no readable date not shown.", and SHALL show no such footnote when none are
left out. A raw-row vertical `bar` chart that plots one point per row (a single series, or the auto-detected
series when no y field is mapped) SHALL instead render a category x axis when two or more rows denote the same
instant, with one bar per row ordered by instant and any row whose x denotes no instant after them in row order,
so that no bar is hidden behind another. Axis labels SHALL use adaptive time labels in UTC; the
tooltip SHALL show the x instant in UTC as `yyyy-MM-dd` when every plotted x is midnight UTC, otherwise as
`yyyy-MM-dd HH:mm`, with user-supplied text rendered literally. Clicking a point on a time axis SHALL produce the
same cross-filter selection (the row's raw x value) as on a category axis. Horizontal bar, pie, heatmap and
histogram charts, and any chart whose x field is not declared `timestamp` (or whose schema is unavailable), SHALL
render a category axis as before; there is no per-chart axis-type setting, and a column declared `string` gets a
time axis by being cast to `timestamp` in its pipeline.

#### Scenario: Irregular dates are sorted and spaced proportionally
- **WHEN** a line chart's x field is declared `timestamp` and its rows have x values `2026-10-09`, `2026-10-01`, `2026-10-02`
- **THEN** the x axis is a time axis and the points are plotted in the order 1 Oct, 2 Oct, 9 Oct, with the gap between 2 Oct and 9 Oct seven times the gap between 1 Oct and 2 Oct

#### Scenario: A time-zone-less date-time is read as UTC
- **WHEN** a timestamp x value is `2026-10-01T12:00` and the viewer's time zone is not UTC
- **THEN** the point is placed at 12:00 UTC on 1 Oct 2026 and the tooltip shows `2026-10-01 12:00`

#### Scenario: Postgres timestamptz text is placed at its offset
- **WHEN** a timestamp x value is `2026-10-01 12:00:00+00` and another is `2026-10-01 17:30:00+0530`
- **THEN** both points are placed at 12:00 UTC on 1 Oct 2026, the same instants the backend reads

#### Scenario: Chart and backend agree case by case
- **WHEN** every case of the shared chart timestamp fixture is parsed by the chart's x parser and by the backend's shared timestamp parser
- **THEN** both yield the same instant (or both yield none) for every case

#### Scenario: A non-timestamp x field is unchanged
- **WHEN** the x field is declared `string` (or no schema is available) and its values look like dates
- **THEN** the chart renders a category x axis with the values in row order, exactly as before

#### Scenario: A horizontal bar keeps its category axis
- **WHEN** a bar chart with `orientation: "horizontal"` has a timestamp x field
- **THEN** the chart renders the category axis exactly as before

#### Scenario: An aggregated chart grouped by a timestamp
- **WHEN** an aggregated bar chart's groupBy field is declared `timestamp`
- **THEN** the grouped values are plotted on a time axis ordered by instant

#### Scenario: Rows with no readable date are counted
- **WHEN** a line chart's x field is declared `timestamp` and 3 of its rows have x values that denote no instant
- **THEN** those rows are not plotted and the chart shows the footnote "3 rows with no readable date not shown."

#### Scenario: Same-date bars fall back to a category axis
- **WHEN** a single-series vertical bar chart's x field is declared `timestamp` and two rows have the x value `2026-10-01` with y values 5 and 9
- **THEN** the chart renders a category x axis with two separate bars for `2026-10-01`, showing 5 and 9

#### Scenario: Distinct dates keep the time axis
- **WHEN** the same bar chart's rows all denote different instants
- **THEN** the chart renders a time x axis

### Requirement: A chart shows a gap where a series has no numeric value
A `line` or `bar` chart SHALL plot no value (`null`) — a break in a line, no bar — wherever a plotted series has no
row, or a non-numeric or empty y value, instead of plotting 0: a multi-series chart at each x where a series has no
row or no numeric y, and a single-series or auto-detected-series chart at each row whose y is not numeric. A
`scatter` chart SHALL draw no point for a row whose y is not numeric. This SHALL hold on category and time x axes
alike. Every series of a multi-series chart SHALL share the same ordered x values; a normalized stacked bar SHALL
compute each x's percent shares from the values present and SHALL plot no bar for a missing value. A tooltip that
lists a missing value (an axis tooltip on a multi-series chart) SHALL show it as `—`, never as `0` or `undefined`; a
single-series gap draws no mark, so it has no hover target of its own.

#### Scenario: A missing point is a gap, not zero
- **WHEN** a multi-series line chart has series A with values at x1, x2, x3 and series B with values only at x1 and x3
- **THEN** series B's value at x2 is null (a gap), not 0

#### Scenario: Normalized stacking with a missing point
- **WHEN** a normalized stacked bar has series A = 30 and series B missing at one x
- **THEN** that x's A bar is 100% and no B bar is drawn there

#### Scenario: Hovering a gap shows no value
- **WHEN** the user hovers the x where series B has no value on a multi-series chart
- **THEN** the tooltip shows `—` for series B, not `0` or `undefined`

#### Scenario: A single-series non-numeric y is a gap
- **WHEN** a single-series bar chart has rows with y values `4`, `n/a`, `7` on a category or time x axis
- **THEN** the second row plots no bar (`null`), not a bar of height 0, so there is nothing to hover at that x

#### Scenario: A scatter point with no numeric y is not drawn
- **WHEN** a scatter chart has a row whose y value is empty
- **THEN** no point is drawn for that row
