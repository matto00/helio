## ADDED Requirements

### Requirement: typeId is set at panel creation time for data-bound panels
When `POST /api/panels` receives a `dataTypeId` field in the request body, the backend SHALL set
`typeId` on the newly created `Panel` domain object and persist it to the `panels.type_id` column.
The `GET /api/dashboards/:id/panels` response for such a panel SHALL return the `typeId` populated,
matching the behavior of a panel that had its binding set via `PATCH /api/panels/:id`.

#### Scenario: POST /api/panels with dataTypeId persists typeId
- **WHEN** `POST /api/panels` is called with `{ "dashboardId": "<id>", "title": "Revenue", "type": "metric", "dataTypeId": "<type-id>" }`
- **THEN** the response is 201 with `typeId` set to `<type-id>`
- **AND** subsequent `GET /api/dashboards/:id/panels` returns the panel with `typeId` populated

#### Scenario: POST /api/panels without dataTypeId creates unbound panel
- **WHEN** `POST /api/panels` is called without a `dataTypeId` field (e.g. for a non-data-bound type)
- **THEN** the response is 201 with `typeId` set to `null`

#### Scenario: Newly created bound panel fetches data on mount
- **WHEN** a panel created with a `dataTypeId` is rendered in the panel grid
- **THEN** the panel fetches data via `GET /api/panels/:id/query` on mount
- **AND** displays data according to its `fieldMapping` (if set) or shows a no-data state
