## MODIFIED Requirements

### Requirement: Panel response includes typeId and fieldMapping
The existing `GET /api/dashboards/:id/panels` endpoint SHALL return each panel with `typeId` and
`fieldMapping` populated (when bound), and SHALL additionally include a `dataAsOf: string | null`
field. The `dataAsOf` field is computed server-side from the pipeline associated with the panel's
bound DataType. The endpoint returns `dataAsOf: null` when the panel is unbound or the pipeline
has never run.

#### Scenario: Panel response includes typeId and fieldMapping
- **WHEN** a panel has been bound to a DataType
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `typeId` and `fieldMapping` populated

#### Scenario: Panel response includes dataAsOf when pipeline has run
- **WHEN** a panel has been bound to a DataType and that DataType's associated pipeline has run
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `dataAsOf` set to an ISO-8601 timestamp

#### Scenario: Panel response includes dataAsOf null for unbound panel
- **WHEN** a panel has no bound DataType
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `dataAsOf: null`
