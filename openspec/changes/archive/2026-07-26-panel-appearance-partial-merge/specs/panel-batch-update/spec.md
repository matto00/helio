## MODIFIED Requirements

### Requirement: POST /api/panels/updateBatch endpoint exists
The backend MUST expose a `POST /api/panels/updateBatch` endpoint that accepts a payload with a
`fields` envelope and a `panels` array, where each entry contains a panel `id` and the field values
to apply. Appearance updates in this endpoint MUST merge over each panel's stored `appearance`
(absent-vs-null, partial-`chart`) — see `panel-appearance-settings`'s "Batch appearance updates use
the same merge semantics as the single-item PATCH" requirement — rather than replacing it.

Note: `panels/updateBatch` handles per-panel fields only (`title`, `appearance`, `type`). Dashboard
layout (the 4-breakpoint position grid) is a dashboard-level attribute and is updated separately via
`PATCH /api/dashboards/:id/update`.

#### Scenario: Panel appearances are updated in batch
- **GIVEN** multiple panels
- **WHEN** a client sends `POST /api/panels/updateBatch` with `{ "fields": ["appearance"], "panels": [{ "id": "p1", "appearance": {...} }] }`
- **THEN** the backend merges the updated appearance into each listed panel's stored appearance,
  transactionally, preserving fields the payload omits

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
