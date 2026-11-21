## ADDED Requirements

### Requirement: Connector row and row-action hovers clear the state-surface floor

On a pointer that can hover, the connector table row, its actions-menu trigger and its standalone "Test connection" button SHALL each show a hover drawn from its DESIGN.md §5 recipe whose background measures at least 1.10 against the backdrop it sits on, in both light and dark themes and at every width. The hover SHALL be declared inside `@media (hover: hover)`.

#### Scenario: Hover is visible in both themes

- **WHEN** a mouse pointer hovers the connector row, its actions trigger, or the "Test connection" button, in light or dark theme
- **THEN** the HEL-866 state-surface contrast guard measures the hovered background at 1.10 or more against its resolved backdrop

#### Scenario: Touch leaves no sticky hover

- **WHEN** the page is used with a pointer that cannot hover
- **THEN** none of these hover rules apply
