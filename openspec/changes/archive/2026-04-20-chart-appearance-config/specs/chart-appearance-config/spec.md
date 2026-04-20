## ADDED Requirements

### Requirement: Chart appearance settings are configurable per panel
The system SHALL support a `chart` sub-object within panel appearance that carries chart-specific visual settings: series colors, legend visibility and position, tooltip enabled state, and axis label visibility and optional custom text.

#### Scenario: Chart appearance sub-object is stored and returned
- **WHEN** a client PATCHes a panel appearance with a `chart` sub-object
- **THEN** the backend persists the chart settings
- **AND** subsequent GET requests for that panel return the `chart` sub-object with the saved values

#### Scenario: Chart appearance defaults are applied when absent
- **WHEN** a panel has no `chart` key in its stored appearance
- **THEN** the system returns sensible defaults (legend shown at bottom, tooltip enabled, both axes shown, default color palette)

### Requirement: Chart panel schema validates chart appearance sub-object
The panel appearance JSON schema MUST define an optional `chart` property that validates series colors, legend, tooltip, and axis label fields.

#### Scenario: Valid chart appearance passes schema validation
- **WHEN** a panel appearance payload includes a valid `chart` object
- **THEN** schema validation passes

#### Scenario: Invalid chart appearance fails schema validation
- **WHEN** a panel appearance payload includes a `chart` object with an invalid field (e.g., legend position not in allowed enum)
- **THEN** schema validation fails with a descriptive error
