## MODIFIED Requirements

### Requirement: Panel resources expose nested appearance settings
Panel resources MUST include a nested `appearance` object that carries panel-level visual customization settings.

#### Scenario: Panel response includes appearance object
- **WHEN** a client fetches panel resources for a dashboard
- **THEN** each panel response includes an `appearance` object
- **AND** the `appearance` object is represented separately from `meta`
- **AND** the `appearance` object includes the supported panel background, color, transparency settings and, for chart panels, an optional `chart` sub-object with series colors, legend, tooltip, and axis label settings

### Requirement: Panel appearance settings are persisted through resource updates
The backend MUST persist supported panel appearance settings so they are returned on subsequent reads.

#### Scenario: Panel appearance is updated
- **GIVEN** an existing panel
- **WHEN** a client submits an update that changes the panel `appearance`
- **THEN** the panel stores the updated background, color, transparency, and `chart` settings
- **AND** a later fetch for that panel returns the saved `appearance` including the `chart` sub-object

#### Scenario: Panel appearance chart sub-object is persisted
- **GIVEN** a chart panel
- **WHEN** a client PATCHes the panel appearance with a `chart` object containing series colors and legend config
- **THEN** a subsequent GET returns the same `chart` object values

### Requirement: Panel appearance contract is validated
The panel schema MUST validate the nested appearance object shape.

#### Scenario: Panel schema defines appearance
- **WHEN** panel payloads are validated against the schema
- **THEN** the schema requires an `appearance` object
- **AND** the appearance object validates the supported panel appearance fields including the optional `chart` sub-object
