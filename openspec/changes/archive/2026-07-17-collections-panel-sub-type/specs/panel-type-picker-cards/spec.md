## MODIFIED Requirements

### Requirement: Each panel type card displays icon, name, and description
The type picker grid MUST render each panel type card with three elements: a visual icon, the type name, and a one-line description that communicates the card's purpose.

#### Scenario: Card content is visible on type-select step
- **WHEN** the panel creation modal opens at the type-select step
- **THEN** each type card SHALL display an icon, the panel type name, and a one-line description
- **AND** the description text SHALL be visually subordinate to the name (smaller, muted color)

#### Scenario: All seven creatable panel types have descriptions
- **WHEN** the type-select step is rendered
- **THEN** cards for metric, chart, text, table, markdown, image, and collection SHALL each show a non-empty description string
- **AND** no card for `divider` SHALL be shown (removed from the creatable type set — HEL-249)
