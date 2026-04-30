## ADDED Requirements

### Requirement: POST /api/panels/updateBatch endpoint exists
The backend MUST expose a `POST /api/panels/updateBatch` endpoint that accepts a payload with a
`fields` envelope and a `panels` array, where each entry contains a panel `id` and the field values
to apply.

Note: `panels/updateBatch` handles per-panel fields only (`title`, `appearance`, `type`). Dashboard
layout (the 4-breakpoint position grid) is a dashboard-level attribute and is updated separately via
`PATCH /api/dashboards/:id/update`.

#### Scenario: Panel appearances are updated in batch
- **GIVEN** multiple panels
- **WHEN** a client sends `POST /api/panels/updateBatch` with `{ "fields": ["appearance"], "panels": [{ "id": "p1", "appearance": {...} }] }`
- **THEN** the backend persists the updated appearance for each listed panel transactionally

#### Scenario: Panel titles are updated in batch
- **GIVEN** multiple panels
- **WHEN** a client sends `POST /api/panels/updateBatch` with `{ "fields": ["title"], "panels": [{ "id": "p1", "title": "Revenue" }] }`
- **THEN** the backend persists the updated title for each listed panel

#### Scenario: Multiple fields are updated in a single batch call
- **GIVEN** multiple panels
- **WHEN** a client sends `fields: ["title", "appearance"]` with panels that carry both fields
- **THEN** both fields are updated for each panel in the array

#### Scenario: Unknown panel id returns 404
- **WHEN** a client includes a panel id that does not exist in the batch
- **THEN** the backend returns HTTP 404 — no partial updates are applied

### Requirement: Panel batch update does not require a dashboard id in the path
The `POST /api/panels/updateBatch` endpoint MUST NOT require a dashboard id path parameter; panel
ids in the request body are sufficient to locate and update each panel.

#### Scenario: Batch call is not scoped to a dashboard
- **WHEN** a client sends `POST /api/panels/updateBatch` with panel ids
- **THEN** the backend locates each panel by its id without requiring a dashboard path segment
