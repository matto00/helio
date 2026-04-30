## ADDED Requirements

### Requirement: PATCH /api/dashboards/:id/update endpoint exists
The backend MUST expose a `PATCH /api/dashboards/:id/update` endpoint that accepts a partial update
payload with a `fields` envelope and a `dashboard` object containing the new values.

#### Scenario: Dashboard name is updated
- **GIVEN** an existing dashboard
- **WHEN** a client sends `PATCH /api/dashboards/:id/update` with `{ "fields": ["name"], "dashboard": { "name": "Renamed" } }`
- **THEN** the backend persists the new name
- **AND** a subsequent GET for that dashboard returns the updated name

#### Scenario: Dashboard appearance is updated
- **GIVEN** an existing dashboard
- **WHEN** a client sends `PATCH /api/dashboards/:id/update` with `{ "fields": ["appearance"], "dashboard": { "appearance": { "background": "#000", "gridBackground": "#111" } } }`
- **THEN** the backend persists the new appearance values
- **AND** a subsequent GET for that dashboard returns the updated appearance

#### Scenario: Unknown dashboard id returns 404
- **WHEN** a client sends `PATCH /api/dashboards/:id/update` for a non-existent dashboard
- **THEN** the backend returns HTTP 404

### Requirement: Dashboard partial update only modifies listed fields
The endpoint MUST only update the fields named in the `fields` array; unlisted fields MUST remain
unchanged.

#### Scenario: Only the listed field is changed
- **GIVEN** a dashboard with a name and an appearance
- **WHEN** a client updates with `fields: ["name"]` only
- **THEN** the name is changed
- **AND** the appearance is unchanged
