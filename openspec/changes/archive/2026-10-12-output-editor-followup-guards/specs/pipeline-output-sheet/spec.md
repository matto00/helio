## ADDED Requirements

### Requirement: Scatter field pickers list their clear option once
In the Output editor, a scatter chart's "Point size field" and "Color by field" pickers SHALL each offer the
"— None —" clear option exactly once, followed by the node's columns, and rendering or opening them SHALL NOT produce
a duplicate-key warning.

#### Scenario: Opening the point size picker
- **WHEN** a chart Output with chart type `scatter` and at least one column is open in the editor and the user opens
  the "Point size field" picker
- **THEN** exactly one option is labelled "— None —"
- **AND** every column appears as an option exactly once

#### Scenario: Opening the color picker
- **WHEN** the user opens the "Color by field" picker of the same Output
- **THEN** exactly one option is labelled "— None —"
- **AND** no duplicate React key warning is logged
