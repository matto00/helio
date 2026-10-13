## MODIFIED Requirements

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

