# panel-type-picker-cards — delta (HEL-305)

## ADDED Requirements

### Requirement: Chart card description names all four chart types

The chart panel type card's one-line description MUST name all four supported chart types (line,
bar, pie, scatter) so the copy does not understate the supported set.

#### Scenario: Chart card copy lists line, bar, pie, and scatter

- **WHEN** the type-select step of the panel creation modal is shown
- **THEN** the chart card's description mentions line, bar, pie, and scatter
