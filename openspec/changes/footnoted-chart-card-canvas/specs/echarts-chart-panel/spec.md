## ADDED Requirements

### Requirement: Value-axis labels never overprint on a short chart

A cartesian chart panel SHALL NOT draw value-axis labels that overlap one another, however short its rendered canvas.
When the canvas is too short for the default number of value-axis ticks, the chart SHALL show fewer labels (at least
the axis minimum and maximum when two labels fit) rather than overprinting them. Category-axis label behaviour (HEL-1512)
is unchanged.

#### Scenario: short canvas shows fewer, non-overlapping labels
- **WHEN** a bar chart renders into a canvas 48px to 100px tall on the desktop grid
- **THEN** no two value-axis labels overlap vertically, at least one value-axis label is drawn, and when two labels fit the axis minimum and maximum are both labelled

#### Scenario: tall canvas is unchanged
- **WHEN** a bar chart renders into a canvas at least 180px tall
- **THEN** its value axis shows the same labels it did before this change
