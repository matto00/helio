## ADDED Requirements

### Requirement: POST /api/panels/updateBatch endpoint exists
The backend MUST expose a `POST /api/panels/updateBatch` endpoint that accepts a payload with a
`fields` envelope and a `panels` array, where each entry contains a panel `id` and the field values
to apply.

#### Scenario: Panel layouts are updated in batch
- **GIVEN** a dashboard with multiple panels
- **WHEN** a client sends `POST /api/panels/updateBatch` with `{ "fields": ["layout"], "panels": [{ "id": "p1", "layout": [...] }, { "id": "p2", "layout": [...] }] }`
- **THEN** the backend persists the updated layouts for all listed panels
- **AND** subsequent GET /api/dashboards/:id/panels returns the updated layouts

#### Scenario: Panel appearances are updated in batch
- **GIVEN** multiple panels
- **WHEN** a client sends `POST /api/panels/updateBatch` with `{ "fields": ["appearance"], "panels": [{ "id": "p1", "appearance": {...} }] }`
- **THEN** the backend persists the updated appearance for each listed panel

#### Scenario: Mixed fields are updated in a single batch call
- **GIVEN** multiple panels
- **WHEN** a client sends `fields: ["layout", "appearance"]` with panels that carry both fields
- **THEN** both fields are updated for each panel in the array

#### Scenario: Unknown panel id is skipped or returns error
- **WHEN** a client includes a panel id that does not exist in the batch
- **THEN** the backend returns HTTP 404 or ignores the unknown id consistently

### Requirement: Panel batch update does not require a dashboard id in the path
The `POST /api/panels/updateBatch` endpoint MUST NOT require a dashboard id path parameter; panel
ids in the request body are sufficient to locate and update each panel.

#### Scenario: Batch call is not scoped to a dashboard
- **WHEN** a client sends `POST /api/panels/updateBatch` with panel ids from different dashboards
- **THEN** the backend processes each panel update independently of dashboard scoping
