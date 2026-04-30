## ADDED Requirements

### Requirement: Dashboard resources expose nested appearance settings
Dashboard resources MUST include a nested `appearance` object that carries dashboard-level visual customization settings.

#### Scenario: Dashboard response includes appearance object
- **WHEN** a client fetches dashboard resources
- **THEN** each dashboard response includes an `appearance` object
- **AND** the `appearance` object is represented separately from `meta`
- **AND** the `appearance` object includes the dashboard background settings supported by the product

### Requirement: Dashboard appearance settings are persisted through resource updates
The backend MUST persist supported dashboard appearance settings so they are returned on subsequent reads.

#### Scenario: Dashboard background is updated via PATCH /api/dashboards/:id
- **GIVEN** an existing dashboard
- **WHEN** a client submits `PATCH /api/dashboards/:id` with an `appearance` field
- **THEN** the dashboard stores the updated background settings
- **AND** a later fetch for that dashboard returns the saved `appearance`

#### Scenario: Dashboard background is updated via PATCH /api/dashboards/:id/update
- **GIVEN** an existing dashboard
- **WHEN** a client submits `PATCH /api/dashboards/:id/update` with `{ "fields": ["appearance"], "dashboard": { "appearance": { ... } } }`
- **THEN** the dashboard stores the updated background settings
- **AND** a later fetch for that dashboard returns the saved `appearance`

### Requirement: Dashboard appearance contract is validated
The dashboard schema MUST validate the nested appearance object shape.

#### Scenario: Dashboard schema defines appearance
- **WHEN** dashboard payloads are validated against the schema
- **THEN** the schema requires an `appearance` object
- **AND** the appearance object validates the supported dashboard background fields
