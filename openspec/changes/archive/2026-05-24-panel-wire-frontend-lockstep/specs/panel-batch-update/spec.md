## MODIFIED Requirements

### Requirement: POST /api/panels/updateBatch endpoint exists
The backend MUST expose a `POST /api/panels/updateBatch` endpoint that accepts a payload with a
`fields` envelope and a `panels` array, where each entry contains a panel `id` and the field values
to apply. Each batch entry's panel-specific config SHALL use the discriminated `type` + typed
`config` wire shape mirroring `PATCH /api/panels/:id`; per-subtype flat fields (`content`,
`imageUrl`, etc.) at the entry root MUST NOT be accepted.

Note: `panels/updateBatch` handles per-panel fields only (`title`, `appearance`, `type`, `config`).
Dashboard layout (the 4-breakpoint position grid) is a dashboard-level attribute and is updated
separately via `PATCH /api/dashboards/:id/update`.

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

#### Scenario: Panel configs are updated in batch via typed config
- **GIVEN** multiple panels of matching types
- **WHEN** a client sends `fields: ["config"]` with panels that carry `type` and a matching `config` payload
- **THEN** the backend persists the updated typed config for each listed panel

#### Scenario: Cross-type batch entry is rejected
- **WHEN** a batch entry carries a `type` that differs from the stored panel's type
- **THEN** the backend returns HTTP 400 and no partial updates are applied

#### Scenario: Unknown panel id returns 404
- **WHEN** a client includes a panel id that does not exist in the batch
- **THEN** the backend returns HTTP 404 — no partial updates are applied
