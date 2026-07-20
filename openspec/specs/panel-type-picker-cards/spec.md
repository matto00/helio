# panel-type-picker-cards Specification

## Purpose
TBD - created by archiving change panel-type-picker-cards. Update Purpose after archive.
## Requirements
### Requirement: Each panel type card displays icon, name, and description
The type picker grid MUST render each panel type card with three elements: a visual icon, the type name, and a one-line description that communicates the card's purpose.

#### Scenario: Card content is visible on type-select step
- **WHEN** the panel creation modal opens at the type-select step
- **THEN** each type card SHALL display an icon, the panel type name, and a one-line description
- **AND** the description text SHALL be visually subordinate to the name (smaller, muted color)

#### Scenario: All eight creatable panel types have descriptions
- **WHEN** the type-select step is rendered
- **THEN** cards for metric, chart, text, table, markdown, image, collection, and timeline SHALL each show a non-empty description string
- **AND** no card for `divider` SHALL be shown (removed from the creatable type set — HEL-249)

#### Scenario: Timeline card communicates a chronological event sequence
- **WHEN** the type-select step is rendered
- **THEN** the `timeline` card SHALL display an icon and a one-line description conveying that it renders a chronological sequence of time-stamped events

### Requirement: Selected card state is visually distinguished
The type picker MUST provide a clear visual active/focus state on the card that is currently highlighted so the user knows which type they are about to select.

#### Scenario: Hovered card is highlighted
- **WHEN** the user hovers over a type card
- **THEN** that card SHALL render with a distinct visual treatment (e.g., accent border color and slightly elevated background)
- **AND** other cards SHALL NOT share that treatment simultaneously

#### Scenario: Focused card is highlighted via keyboard
- **WHEN** the user navigates to a type card via keyboard (Tab/arrow) and it receives focus
- **THEN** that card SHALL render with a visible focus indicator using the accent color

### Requirement: Chart card description names all four chart types

The chart panel type card's one-line description MUST name all four supported chart types (line,
bar, pie, scatter) so the copy does not understate the supported set.

#### Scenario: Chart card copy lists line, bar, pie, and scatter

- **WHEN** the type-select step of the panel creation modal is shown
- **THEN** the chart card's description mentions line, bar, pie, and scatter

