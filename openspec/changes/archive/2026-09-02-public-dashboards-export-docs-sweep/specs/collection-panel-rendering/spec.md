## MODIFIED Requirements

### Requirement: Collection empty and unbound states
An unbound collection panel (no `outputId`) SHALL render a placeholder state consistent with the
other data-bound kinds. A bound collection whose snapshot has zero rows SHALL render a "No data"
state rather than an empty body.

#### Scenario: Unbound collection shows placeholder
- **WHEN** a collection panel with no bound DataType renders in the grid
- **THEN** the body shows an unbound placeholder inviting configuration, not an error

#### Scenario: Bound collection with zero rows shows no-data state
- **WHEN** a bound collection's DataType snapshot contains zero rows
- **THEN** the body shows a "No data" state

