## MODIFIED Requirements

### Requirement: Histogram bins a numeric field
A histogram SHALL bin the numeric values of `fieldMapping.xAxis` into equal-width bins spanning the minimum to the
maximum value and plot each bin's row count as adjacent bars labelled with the bin range. The bin count SHALL be
`config.chartOptions.histogram.binCount` when set, otherwise `ceil(log2(n)) + 1` for n numeric values, clamped to
1-50. When every numeric value is equal there SHALL be a single bin, even when a bin count is configured. Blank and non-numeric cells SHALL be skipped, and
when any are skipped the chart SHALL show a visible note stating how many values were skipped.
Every bin range label in a histogram with more than one bin SHALL show its numbers with the same number of decimal
places: the fewest
places (0 to 20) at which every bin edge is shown exactly, but never more than one place beyond the first significant
decimal of the bin width, with every edge treated as exact when it is within one millionth of a bin width of the
shown value. A single bin SHALL keep the shared chart number format for its value. When the bin width is at least
1e-19 and at least 1e-13 times the largest absolute bin edge, adjacent bins SHALL never share an identical label.

#### Scenario: Automatic bin count
- **WHEN** a histogram with no binCount plots 100 numeric values
- **THEN** it draws 8 bins whose counts sum to 100

#### Scenario: Configured bin count
- **WHEN** a histogram with `chartOptions.histogram.binCount: 5` plots values 0 to 10
- **THEN** it draws 5 equal-width bins covering 0 to 10, the maximum value counted in the last bin

#### Scenario: Non-numeric cells are skipped and counted
- **WHEN** a histogram's field holds 10 numbers, 2 blanks and 1 "n/a"
- **THEN** the bins count 10 values and the chart shows a note that 3 values were skipped

#### Scenario: Bin labels share one precision
- **WHEN** a histogram with `binCount: 4` plots values 0 to 10 (bin width 2.5)
- **THEN** its labels are "0.0 to 2.5", "2.5 to 5.0", "5.0 to 7.5" and "7.5 to 10.0"

#### Scenario: Integer edges show no decimals
- **WHEN** a histogram with `binCount: 5` plots values 0 to 10 (bin width 2)
- **THEN** its labels are "0 to 2", "2 to 4", "4 to 6", "6 to 8" and "8 to 10"

#### Scenario: No negative zero in a bin label
- **WHEN** a histogram with `binCount: 6` plots values -0.1 to 0.5
- **THEN** no bin edge is shown as a negative zero (e.g. "-0.0"), and the bin edge at zero reads "0.0"

#### Scenario: Large-magnitude values with narrow bins stay distinguishable
- **WHEN** a histogram with `binCount: 8` plots epoch-second values 1700000000 to 1700000002
- **THEN** its labels use 2 decimal places (bin width 0.25) and no two adjacent labels are identical

#### Scenario: Very narrow bins stay distinguishable
- **WHEN** a histogram with `binCount: 4` plots values 0 to 0.000001
- **THEN** its four labels all use the same number of decimal places and no two are identical

#### Scenario: A single bin keeps its value
- **WHEN** a histogram's numeric values are all 1700000000.5
- **THEN** its one bin label reads "1700000000.5"

#### Scenario: Narrow bins stay distinguishable
- **WHEN** a histogram with `binCount: 3` plots values 0 to 0.01
- **THEN** its three labels all use the same number of decimal places and no two are identical

### Requirement: Output editor configures heatmap and histogram
The Output editor's chart-type selector SHALL offer Heatmap and Histogram. For either type it SHALL hide the
aggregation fields with a hint that the type does not aggregate, and SHALL save `aggregation: null`. The heatmap hint
SHALL state that rows sharing a column and row value are summed into one cell. For a heatmap it
SHALL show labelled field pickers Columns (`xAxis`), Rows (`series`) and Value (`yAxis`); for a
histogram a Field picker (`xAxis`). Value and Field SHALL list only the columns the server reports as numeric for a
chart value; a stored non-numeric choice SHALL stay selected and be marked not numeric, and with no numeric column
the picker SHALL be disabled with a hint to cast a column to a number. A histogram SHALL also always show a bin-count
control that is Automatic by default or a whole number from 2 to 100 saved as `chartOptions.histogram.binCount` (Automatic saves no binCount). The controls
SHALL use the shared editor components and DESIGN.md tokens, and meet the editor's existing mobile touch-target rules
at 375px.

#### Scenario: Configure a heatmap in the editor
- **WHEN** an author chooses Heatmap, picks Columns `day`, Rows `test`, Value `failures` and saves
- **THEN** the saved config has `chartType: "heatmap"`, `fieldMapping` `{xAxis: "day", series: "test", yAxis:
  "failures"}` and `aggregation: null`

#### Scenario: Set a histogram bin count
- **WHEN** an author chooses Histogram, picks Field `duration`, sets bins to 12 and saves
- **THEN** the saved config has `fieldMapping.xAxis: "duration"` and `chartOptions.histogram.binCount: 12`

#### Scenario: Heatmap hint describes summing
- **WHEN** an author chooses Heatmap in the Output editor
- **THEN** the aggregation hint says rows sharing a column and row are summed into one cell, and does not say the rows
  are plotted as they are
