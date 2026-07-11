## Purpose

Defines the `POST /api/panels/updateBatch` endpoint that applies title, appearance, and typed-config
patches to many panels in a single transaction, without requiring a dashboard-scoped path.
## Requirements
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

### Requirement: Config-patch batch updates persist every typed-config column
When `POST /api/panels/updateBatch` is called with `fields: ["config"]`, the backend MUST persist
every typed-config column produced for the patched panel — including `aggregation` for metric and
chart panels — not a fixed subset. The set of columns written by the batch config-patch path MUST
be the same set written by the single-panel replace path (`PanelRepository.replace`), sourced from
one shared definition, so the two paths cannot silently diverge as new config columns are added.

#### Scenario: Batch config patch persists a metric panel's aggregation spec
- **GIVEN** a metric panel with no `aggregation` set
- **WHEN** a client sends `POST /api/panels/updateBatch` with
  `fields: ["config"], panels: [{ id: "p1", config: { aggregation: { value: "rating", agg: "avg" } } }]`
- **THEN** the panel's `aggregation` column is persisted and a subsequent read of the panel reflects
  `{ value: "rating", agg: "avg" }`

#### Scenario: Batch config patch persists a chart panel's aggregation spec
- **GIVEN** a chart panel with no `aggregation` set
- **WHEN** a client sends `POST /api/panels/updateBatch` with
  `fields: ["config"], panels: [{ id: "p1", config: { aggregation: { groupBy: "year", agg: "avg", yField: "rating" } } }]`
- **THEN** the panel's `aggregation` column is persisted and a subsequent read of the panel reflects
  `{ groupBy: "year", agg: "avg", yField: "rating" }`

#### Scenario: Batch config-patch column set stays in parity with the single-panel replace path
- **WHEN** a new typed-config column is added to `PanelRow` and the single-panel replace path is
  updated to write it
- **THEN** the batch config-patch path, sourced from the same shared column-list definition, writes
  that column too without requiring a separate manual edit

