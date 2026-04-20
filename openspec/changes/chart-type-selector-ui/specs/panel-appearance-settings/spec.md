## MODIFIED Requirements

### Requirement: Panel resources expose nested appearance settings
Panel resources MUST include a nested `appearance` object that carries panel-level visual customization settings,
including `chartType` for chart panels.

#### Scenario: Panel response includes appearance object
- **WHEN** a client fetches panel resources for a dashboard
- **THEN** each panel response includes an `appearance` object
- **AND** the `appearance` object is represented separately from `meta`
- **AND** the `appearance` object includes the supported panel background, color, transparency, and (for chart panels) chartType settings

### Requirement: Panel appearance settings are persisted through resource updates
The backend MUST persist supported panel appearance settings so they are returned on subsequent reads,
including `chartType` when present.

#### Scenario: Panel appearance is updated
- **GIVEN** an existing panel
- **WHEN** a client submits an update that changes the panel `appearance`
- **THEN** the panel stores the updated background, color, transparency, and chartType settings
- **AND** a later fetch for that panel returns the saved `appearance` including `chartType`

### Requirement: Panel appearance contract is validated
The panel schema MUST validate the nested appearance object shape, including the optional `chartType` field.

#### Scenario: Panel schema defines appearance with chartType
- **WHEN** panel payloads are validated against the schema
- **THEN** the schema requires an `appearance` object
- **AND** the appearance object validates the supported panel appearance fields including optional `chartType` as one of: line, bar, pie, scatter
