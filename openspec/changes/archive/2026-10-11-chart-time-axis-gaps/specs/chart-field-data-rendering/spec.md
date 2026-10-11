## ADDED Requirements

### Requirement: A timestamp x field renders on a time axis
When the field plotted on the x axis is declared `timestamp` in the Output's schema, a `line`, `scatter`, or
vertical `bar` chart (raw rows, or an aggregation grouped by that field) SHALL render a continuous time x axis:
points SHALL be ordered by the instant their x value denotes and spaced in proportion to the time between them.
An x value SHALL denote an instant exactly as the backend reads it — whole-number epochs (seconds, or
milliseconds above 9999999999), ISO instants and offset date-times, time-zone-less date-times read as UTC, and
bare `yyyy-MM-dd` dates as midnight UTC — and additionally `MM/dd/yyyy` as midnight UTC. A row whose x value
denotes no instant SHALL NOT be plotted on the time axis. Axis labels SHALL use adaptive time labels in UTC; the
tooltip SHALL show the x instant in UTC as `yyyy-MM-dd` when every plotted x is midnight UTC, otherwise as
`yyyy-MM-dd HH:mm`, with user-supplied text rendered literally. Clicking a point on a time axis SHALL produce the
same cross-filter selection (the row's raw x value) as on a category axis. Horizontal bar, pie, heatmap and
histogram charts, and any chart whose x field is not declared `timestamp` (or whose schema is unavailable), SHALL
render exactly as before.

#### Scenario: Irregular dates are sorted and spaced proportionally
- **WHEN** a line chart's x field is declared `timestamp` and its rows have x values `2026-10-09`, `2026-10-01`, `2026-10-02`
- **THEN** the x axis is a time axis and the points are plotted in the order 1 Oct, 2 Oct, 9 Oct, with the gap between 2 Oct and 9 Oct seven times the gap between 1 Oct and 2 Oct

#### Scenario: A time-zone-less date-time is read as UTC
- **WHEN** a timestamp x value is `2026-10-01T12:00` and the viewer's time zone is not UTC
- **THEN** the point is placed at 12:00 UTC on 1 Oct 2026 and the tooltip shows `2026-10-01 12:00`

#### Scenario: A non-timestamp x field is unchanged
- **WHEN** the x field is declared `string` (or no schema is available) and its values look like dates
- **THEN** the chart renders a category x axis with the values in row order, exactly as before

#### Scenario: A horizontal bar keeps its category axis
- **WHEN** a bar chart with `orientation: "horizontal"` has a timestamp x field
- **THEN** the chart renders the category axis exactly as before

#### Scenario: An aggregated chart grouped by a timestamp
- **WHEN** an aggregated bar chart's groupBy field is declared `timestamp`
- **THEN** the grouped values are plotted on a time axis ordered by instant

### Requirement: A multi-series chart shows a gap where a series has no value
A chart with a series field SHALL plot no value (`null`) — a break in a line, no bar — at each x where a series has
no row, or no numeric y value, instead of plotting 0. This SHALL hold on category and time x axes alike. Every
series SHALL share the same ordered x values; a normalized stacked bar SHALL compute each x's percent shares from
the values present and SHALL plot no bar for a missing value. A tooltip SHALL show a missing value as `—`, never as
`0` or `undefined`.

#### Scenario: A missing point is a gap, not zero
- **WHEN** a multi-series line chart has series A with values at x1, x2, x3 and series B with values only at x1 and x3
- **THEN** series B's value at x2 is null (a gap), not 0

#### Scenario: Normalized stacking with a missing point
- **WHEN** a normalized stacked bar has series A = 30 and series B missing at one x
- **THEN** that x's A bar is 100% and no B bar is drawn there

#### Scenario: Hovering a gap shows no value
- **WHEN** the user hovers the x where series B has no value on a multi-series chart
- **THEN** the tooltip shows `—` for series B, not `0` or `undefined`
