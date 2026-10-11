## MODIFIED Requirements

### Requirement: buildChartOption draws a labelled "vs" overlay series
`buildChartOption` SHALL accept an optional overlay `{label, points}` and, for `line` and `bar` chart types with a category or time x axis and exactly one primary series, append one extra series named by `label` (e.g. "vs 7d", "vs 5 Oct, 14:02") whose data is aligned to the primary x values (missing → null): on a category axis by exact category value; on a time axis by the instant each x value denotes (read exactly as the time-axis rule in `chart-field-data-rendering` reads it), so an overlay x of `2026-10-01` aligns to a primary x of `2026-10-01T00:00:00Z`. The overlay SHALL be visually subordinate (dashed line / muted fill drawn from theme tokens or the chart palette data), SHALL appear in the legend, and SHALL be ignored for `pie`, `scatter`, multi-series primaries, bar charts with `stacking: "normalized"` (percent shares on a 0–100 axis), bar charts with `orientation: "horizontal"`, or when no primary x value matches any overlay point.

#### Scenario: Line overlay
- **WHEN** a single-series line chart has categories [Mon,Tue,Wed] and the overlay points are [[Mon,3],[Wed,5]]
- **THEN** the option has a second series named with the overlay label and data [3,null,5]

#### Scenario: Line overlay on a time axis
- **WHEN** a single-series line chart has a time x axis with points at 2026-10-01, 2026-10-02 and 2026-10-09, and the overlay points are [["2026-10-01T00:00:00Z",3],["2026-10-09",5]]
- **THEN** the option has a second series named with the overlay label whose values at those three instants are 3, null and 5

#### Scenario: Normalized and horizontal bars ignore overlay
- **WHEN** a single-series bar chart has `stacking: "normalized"`, or `orientation: "horizontal"`, and an overlay is supplied
- **THEN** the option has no overlay series

#### Scenario: Pie ignores overlay
- **WHEN** the chart type is pie and an overlay is supplied
- **THEN** the option has no overlay series
