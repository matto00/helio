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
9999999999) whose instant lies in years 0001–9999, written in ASCII or any other Unicode decimal digits as the backend reads a numeric string, ISO instants and offset date-times, `T`- or space-separated date-times with a numeric offset
`+HH`/`+HHMM`/`+HH:MM`/`+HH:MM:SS` of at most 18:00 (either optionally followed by a bracketed id, read at the
written offset), time-zone-less date-times read as UTC, bare `yyyy-MM-dd` dates and
`MM/dd/yyyy` dates as midnight UTC. Only surrounding characters at or below U+0020 are ignored, as the backend trims; a value padded with any other whitespace (such as U+00A0) denotes no instant. A row whose x value
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

#### Scenario: A Unicode-digit epoch is placed like its ASCII spelling
- **WHEN** a timestamp x value is the whole-number epoch `1700000000` written in Arabic-Indic digits (`١٧٠٠٠٠٠٠٠٠`)
- **THEN** the point is placed at the same instant as `1700000000`, the instant the backend reads

#### Scenario: Non-ASCII whitespace padding is not trimmed
- **WHEN** a timestamp x value is `2026-10-01` preceded by U+00A0
- **THEN** the row is not plotted and counts toward the "no readable date" footnote, as the backend reads no instant

#### Scenario: Chart and pipeline steps agree on the corpus timestamp strings
- **WHEN** a string that the pipeline step parity corpus feeds to a timestamp reader is parsed by the chart's x parser and by the backend's shared timestamp parser
- **THEN** both yield the same instant (or both yield none)

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

### Requirement: A time axis never ticks finer than its data
A chart rendered on a time x axis (raw rows or an aggregation grouped by a timestamp field) SHALL NOT place ticks
closer together than the granularity of its plotted instants: when every plotted instant is a whole UTC day the
minimum tick interval SHALL be one day; otherwise when every instant is a whole UTC hour, one hour; otherwise a whole
UTC minute, one minute; otherwise a whole second, one second; otherwise there SHALL be no minimum. At any chart width
the axis SHALL therefore never label a time of day for whole-day data.

#### Scenario: Daily data gets no hour ticks
- **WHEN** a line chart's x field is declared `timestamp` and every row's x is a bare `yyyy-MM-dd` date
- **THEN** the time axis's minimum tick interval is one day, and no axis label shows a time of day at 375 px or at desktop width

#### Scenario: Hourly data may tick by the hour
- **WHEN** every plotted instant is on a whole UTC hour and at least one is not midnight
- **THEN** the minimum tick interval is one hour

#### Scenario: Irregular instants keep the default ticks
- **WHEN** a plotted instant has a non-zero millisecond part
- **THEN** the time axis sets no minimum tick interval

### Requirement: Rows that share an x and series are summed
A multi-series `line` or `bar` chart built from raw rows SHALL plot, at each x and series, the sum of the numeric y
values of every row with that x and series value, on category and time x axes alike (on a time axis, rows whose x
values denote the same instant share an x). A row whose y is not numeric SHALL contribute nothing; an x and series
with no numeric y SHALL remain a gap. When two or more rows are summed into one point anywhere in the chart, the chart
SHALL show a footnote stating how many rows were summed, "N rows with the same x value and series were added together."
(on a time axis, "N rows with the same time and series were added together."), counting every row that took part in a sum of two or more,
and SHALL show no such footnote otherwise. Aggregated, single-series, auto-detected-series, scatter and pie charts are
unchanged.

#### Scenario: Two rows at one x and series are added
- **WHEN** a multi-series bar chart on a category axis has rows (`Mon`, `A`, 3) and (`Mon`, `A`, 4)
- **THEN** series A plots 7 at `Mon` and the chart shows "2 rows with the same x value and series were added together."

#### Scenario: Two spellings of one instant are added on a time axis
- **WHEN** a multi-series line chart's x field is declared `timestamp` and series A has rows at `2026-10-01` (2) and `2026-10-01T00:00:00Z` (5)
- **THEN** series A plots 7 at 1 Oct 2026 and the chart shows "2 rows with the same time and series were added together."

#### Scenario: Different times on one date are not summed
- **WHEN** a multi-series line chart's x field is declared `timestamp` and series A has rows at `2026-10-01T01:00` (2) and `2026-10-01T02:00` (5)
- **THEN** series A plots 2 and 5 at their own instants and no summed-rows footnote is shown

#### Scenario: A non-numeric y does not take part in a sum
- **WHEN** series A has rows (`Mon`, `A`, 3) and (`Mon`, `A`, `n/a`)
- **THEN** series A plots 3 at `Mon` and no summed-rows footnote is shown

#### Scenario: Distinct x and series values show no footnote
- **WHEN** no two rows share both an x and a series value
- **THEN** every point is plotted as before and no summed-rows footnote is shown

### Requirement: A scatter does not plot a non-numeric x
A `scatter` chart with a mapped y field whose x is not on a time axis SHALL draw no point for a row whose x value is not numeric (never a
point at 0), and SHALL show a footnote stating how many rows were left out this way, "N rows with no numeric x value not
shown." ("1 row with no numeric x value not shown."), counting every row whose x is not numeric; it SHALL show no such
footnote when none are left out.

#### Scenario: A non-numeric x is not drawn at 0
- **WHEN** a scatter chart with a non-timestamp x field has rows with x values `1`, `abc`, `3` and numeric y values
- **THEN** two points are drawn, none at x = 0, and the chart shows "1 row with no numeric x value not shown."

### Requirement: An isolated value stays visible on a line without markers
A `line` series whose point markers are hidden SHALL still show a marker on every point whose value is numeric and
whose neighbouring points in the series (the previous and the next, where they exist) all have no value, so a value
standing alone between gaps, or the only value of a series, is visible. Points with a numeric neighbour SHALL keep
their markers hidden.

#### Scenario: A value between two gaps shows a marker
- **WHEN** a single-series line chart with markers off has y values `4`, `n/a`, `7`, `n/a`, `5`, `6`
- **THEN** the point 7 shows a marker, as does 4 (its only neighbour is a gap), and 5 and 6 show none

#### Scenario: An isolated point on a repeated category is marked where it is drawn
- **WHEN** a category line with markers off has x values `a`, `b`, `a` with y values `1`, `n/a`, `3`
- **THEN** the markers for 1 and 3 are drawn at the first and third positions respectively, not both at the first `a`

#### Scenario: Markers on keeps every marker
- **WHEN** the same chart has markers on (or the setting is absent)
- **THEN** every point's marker shows as before
