## Purpose

Defines the heatmap and histogram chart types: which Output fields each reads, how they render and bin, and how the
Output editor configures them, so a matrix or a distribution no longer falls back to a bar chart.

## ADDED Requirements

### Requirement: Heatmap and histogram are chart types everywhere chart types are enumerated
`heatmap` and `histogram` SHALL be valid chart types on every surface that enumerates chart types: an Output's
`config.chartType`, a panel's `appearance.chart.chartType`, dashboard proposals, the assistant's proposal tool schema,
the MCP tools' chart-type enums and descriptions, and every JSON schema under `schemas/` that lists chart types. The
set of chart types accepted by the backend, listed in the JSON schemas and offered by the frontend SHALL be identical.

#### Scenario: Output created with a new chart type
- **WHEN** a chart Output is created with `chartType: "heatmap"` or `chartType: "histogram"`
- **THEN** the write succeeds and the stored config carries that chartType

#### Scenario: Panel appearance accepts a new chart type
- **WHEN** a panel's appearance is patched with `chart.chartType: "histogram"`
- **THEN** the stored appearance carries `chart.chartType: "histogram"`

#### Scenario: Client and server agree on the chart-type set
- **WHEN** the frontend chart-type list, the backend accepted set and each schema chart-type enum are compared
- **THEN** they contain exactly the same values (schemas may additionally allow `null`)

### Requirement: Heatmap renders a summed x by row matrix with a themed colour scale
A heatmap SHALL plot `fieldMapping.xAxis` values as columns, `fieldMapping.series` values as rows and the numeric
`fieldMapping.yAxis` value as each cell's colour. Rows sharing the same column and row value SHALL be summed into one
cell; columns and rows SHALL appear in first-appearance order of the loaded rows; non-numeric values contribute
nothing to a sum, and a cell with no numeric value SHALL be left empty. A colour
scale legend spanning the plotted minimum to maximum SHALL be shown, and the scale's colours, text and empty-cell
styling SHALL come from theme tokens so the chart is legible in both light and dark themes. When any of the three
slots is unmapped the heatmap SHALL render an empty chart rather than guess columns.

#### Scenario: Duplicate cells are summed
- **WHEN** a heatmap's rows contain (Mon, testA, 2) and (Mon, testA, 3)
- **THEN** the Mon/testA cell has value 5

#### Scenario: Colour scale in both themes
- **WHEN** a heatmap panel renders in the light theme and in the dark theme
- **THEN** each shows a colour scale legend whose colours and labels come from that theme's tokens

#### Scenario: Missing row slot
- **WHEN** a heatmap Output maps `xAxis` and `yAxis` but not `series`
- **THEN** the chart renders no cells and no error

### Requirement: Histogram bins a numeric field
A histogram SHALL bin the numeric values of `fieldMapping.xAxis` into equal-width bins spanning the minimum to the
maximum value and plot each bin's row count as adjacent bars labelled with the bin range. The bin count SHALL be
`config.chartOptions.histogram.binCount` when set, otherwise `ceil(log2(n)) + 1` for n numeric values, clamped to
1-50. When every numeric value is equal there SHALL be a single bin, even when a bin count is configured. Blank and non-numeric cells SHALL be skipped, and
when any are skipped the chart SHALL show a visible note stating how many values were skipped.

#### Scenario: Automatic bin count
- **WHEN** a histogram with no binCount plots 100 numeric values
- **THEN** it draws 8 bins whose counts sum to 100

#### Scenario: Configured bin count
- **WHEN** a histogram with `chartOptions.histogram.binCount: 5` plots values 0 to 10
- **THEN** it draws 5 equal-width bins covering 0 to 10, the maximum value counted in the last bin

#### Scenario: Non-numeric cells are skipped and counted
- **WHEN** a histogram's field holds 10 numbers, 2 blanks and 1 "n/a"
- **THEN** the bins count 10 values and the chart shows a note that 3 values were skipped

### Requirement: Output editor configures heatmap and histogram
The Output editor's chart-type selector SHALL offer Heatmap and Histogram. For either type it SHALL hide the
aggregation fields with a hint that the type does not aggregate, and SHALL save `aggregation: null`. For a heatmap it
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

### Requirement: Large and history views of heatmap and histogram
Over the dashboard row cap a heatmap or histogram SHALL plot the loaded rows and show the same truncation note as
other chart types. The Output History view SHALL NOT draw a heatmap or histogram from the stored summary series; it
SHALL show a muted note that a history chart is not drawn for that chart type, while the rest of the History view is
unchanged. The stored history summary for these types SHALL be recorded exactly as before this change.

#### Scenario: Truncated histogram
- **WHEN** a histogram panel loads 200 of 1,000 rows
- **THEN** it bins the 200 loaded rows and shows "Based on the first 200 of 1,000 rows."

#### Scenario: History view of a heatmap Output
- **WHEN** the History view opens for a heatmap Output
- **THEN** it shows the note in place of a chart and no error
