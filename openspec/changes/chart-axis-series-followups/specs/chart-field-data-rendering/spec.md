## ADDED Requirements

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
