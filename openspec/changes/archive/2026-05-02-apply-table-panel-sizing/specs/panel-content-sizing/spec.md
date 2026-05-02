## MODIFIED Requirements

### Requirement: Table panel sizing
The table panel (`panel-content--table`) SHALL fill the full available content height within the panel card
by using `flex: 1`, `flex-direction: column`, `justify-content: flex-start`, `align-items: stretch`,
`overflow-y: auto`, and `min-height: 0`. The `<table>` element SHALL have `height: 100%` so it expands to
fill short tables without dead space, and `min-height: min-content` to avoid collapsing when empty.
Cell padding of `4px 8px`, cell height of `18px`, and font-size of `0.78rem` (12.48px) are unchanged.
Header cells SHALL have `background: var(--app-accent-surface)` and `border: 1px solid var(--app-border-subtle)`.

#### Scenario: Table panel with multiple rows exceeding panel height
- **WHEN** a table panel renders more rows than can fit in the available panel content height
- **THEN** the `.panel-content--table` container SHALL scroll vertically and the panel card boundary SHALL NOT be exceeded

#### Scenario: Table panel with few rows
- **WHEN** a table panel renders 1-3 data rows at the default 5-row panel height
- **THEN** the table SHALL occupy the top of the content area with no dead space gap between the last row and the panel footer area — the table element fills available height

#### Scenario: Table panel fills panel area
- **WHEN** a table panel is rendered at any height in the dashboard grid
- **THEN** the `.panel-content--table` element SHALL fill the full available content height (flex: 1 behaviour), leaving no unused vertical space below the panel card content region
