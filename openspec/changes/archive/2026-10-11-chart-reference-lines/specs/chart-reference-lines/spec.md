## Purpose

Lets a chart Output show static target values (an SLO, a goal) as labelled horizontal reference lines and translucent
reference bands on the chart's value axis, themed for light and dark.

## ADDED Requirements

### Requirement: Reference lines render on supported chart types
A chart rendered from a chart Output whose config carries `referenceLines` SHALL draw, for each valid line, a labelled
line across the plot at that value on the value axis, on `bar`, `line`, `scatter` and `histogram` charts (on a
histogram, the count axis). The label SHALL be the line's `label`, or the formatted value when no label is set. On a
horizontal-orientation bar chart the line SHALL sit on the value axis (rendering vertically). Lines and bands SHALL NOT
be drawn on `pie` or `heatmap` charts, nor on a bar chart with normalized (percent) stacking; their stored config SHALL
be preserved in those cases.

#### Scenario: Labelled threshold on a line and a bar chart
- **WHEN** a line chart and a bar chart each render an Output with `referenceLines: [{"value": 95, "label": "SLO"}]`
- **THEN** each chart shows a line at 95 on the value axis labelled "SLO"

#### Scenario: Unlabelled line shows its value
- **WHEN** a line has no `label`
- **THEN** its label is the formatted value (e.g. `95`)

#### Scenario: Unsupported chart types draw nothing
- **WHEN** the same Output is rendered as a pie or heatmap chart, or as a normalized stacked bar
- **THEN** no reference line or band is drawn and the stored config is unchanged

### Requirement: Reference bands render as translucent ranges
For each valid entry of `referenceBands` on a supported chart, the chart SHALL draw a translucent filled range between
`from` and `to` on the value axis, with the band's label (if set) inside its top edge. In a compact chart (the mobile panel stack, or any chart whose
measured height is 179px or less) band labels SHALL NOT be drawn, because the plot is too short for a label that can
only sit on the bars; the band itself and line labels are still drawn.

#### Scenario: Band between two values
- **WHEN** a bar chart renders `referenceBands: [{"from": 0, "to": 50, "label": "OK", "tone": "success"}]`
- **THEN** a translucent success-toned range is drawn from 0 to 50 labelled "OK"

#### Scenario: Compact chart
- **WHEN** the same chart renders in the mobile panel stack, or at a measured height of 179px or less, with a labelled
  line and a labelled band
- **THEN** the band is drawn without its label, and the line is drawn with its label

### Requirement: Reference marks are always visible and inert
The value axis SHALL extend to include every drawn line and band even when it lies outside the data's range. A
reference mark SHALL NOT appear as a legend entry, SHALL NOT be hidden by toggling a data series in the legend, and
clicking it SHALL NOT produce a cross-filter selection. Lines and bands SHALL coexist with the "vs" comparison
overlay.

#### Scenario: Threshold above the data
- **WHEN** a line chart's data maximum is 40 and a reference line is at 95
- **THEN** the value axis extends to at least 95 and the line is visible

#### Scenario: Mark inside the data range leaves the axis unchanged
- **WHEN** a bar chart's data spans 5 to 37.3 and a reference line is at 20
- **THEN** the value axis extent is the same as without the line (zero baseline kept)

#### Scenario: Overlay and a reference line together
- **WHEN** a single-series line chart draws the "vs" overlay and a neutral reference line
- **THEN** both are drawn, the reference line is visually distinct from the overlay line, and the chart's tooltip
  trigger is the same as without the reference line

#### Scenario: Hovering a data series does not fade the marks
- **WHEN** a user hovers a data series on a chart with a reference line and band
- **THEN** the line and its label stay fully opaque and the band keeps its normal translucency

#### Scenario: Clicking a mark
- **WHEN** a user clicks a reference line on an interactive chart
- **THEN** no cross-filter selection is made

### Requirement: Reference marks use the tone vocabulary in both themes
A line's or band's `tone` SHALL map to the theme's `--app-text-muted` (`neutral`, the default), `--app-success`,
`--app-warning` or `--app-error` colour, re-resolved when the theme changes; no free colour SHALL be accepted.

#### Scenario: Theme switch
- **WHEN** a chart with a `warning` line is viewed in the light theme and then the dark theme
- **THEN** the line uses each theme's `--app-warning` colour

### Requirement: Reference marks are editable in the Output editor
The Output editor SHALL let an author add, edit and remove up to 5 reference lines (value, optional label, tone) and up
to 3 reference bands (from, to, optional label, tone) for a chart Output whose chart type is bar, line, scatter or
histogram, and SHALL hide the section for other chart types. An invalid entry (missing, non-numeric or non-finite value, `from`
not less than `to`, trimmed label over 60 characters) SHALL show an inline error and block Save. Saving an Output whose reference
marks were not touched SHALL NOT write either key.

#### Scenario: Adding a line
- **WHEN** an author adds a line with value 95, label "SLO", tone Warning, and saves
- **THEN** the label is trimmed before saving, and the Output's config stores `referenceLines: [{"value": 95, "label": "SLO", "tone": "warning"}]` and the
  preview shows the line

#### Scenario: Caps in the editor
- **WHEN** an author has 5 lines
- **THEN** the "Add line" control is disabled
