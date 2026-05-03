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

#### Scenario: All seven panel types have descriptions
- **WHEN** the type-select step is rendered
- **THEN** cards for metric, chart, text, table, markdown, image, and divider SHALL each show a non-empty description string

### Requirement: Selected card state is visually distinguished
The type picker MUST provide a clear visual active/focus state on the card that is currently highlighted so the user knows which type they are about to select.

#### Scenario: Hovered card is highlighted
- **WHEN** the user hovers over a type card
- **THEN** that card SHALL render with a distinct visual treatment (e.g., accent border color and slightly elevated background)
- **AND** other cards SHALL NOT share that treatment simultaneously

#### Scenario: Focused card is highlighted via keyboard
- **WHEN** the user navigates to a type card via keyboard (Tab/arrow) and it receives focus
- **THEN** that card SHALL render with a visible focus indicator using the accent color

