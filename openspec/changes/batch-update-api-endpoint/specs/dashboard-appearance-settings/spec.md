## MODIFIED Requirements

### Requirement: Dashboard appearance settings are persisted through resource updates
The backend MUST persist supported dashboard appearance settings so they are returned on subsequent
reads. Dashboard appearance MUST be updatable via `PATCH /api/dashboards/:id/update` in addition to
the existing `PATCH /api/dashboards/:id`.

#### Scenario: Dashboard background is updated via the partial update endpoint
- **GIVEN** an existing dashboard
- **WHEN** a client submits `PATCH /api/dashboards/:id/update` with `{ "fields": ["appearance"], "dashboard": { "appearance": { ... } } }`
- **THEN** the dashboard stores the updated background settings
- **AND** a later fetch for that dashboard returns the saved `appearance`

#### Scenario: Dashboard background is updated via the legacy endpoint
- **GIVEN** an existing dashboard
- **WHEN** a client submits a PATCH to `PATCH /api/dashboards/:id` with an `appearance` field
- **THEN** the dashboard stores the updated background settings
- **AND** a later fetch for that dashboard returns the saved `appearance`
