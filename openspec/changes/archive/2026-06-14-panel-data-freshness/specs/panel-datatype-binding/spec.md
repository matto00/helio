## ADDED Requirements

### Requirement: Panel response includes dataAsOf field for data freshness
The `GET /api/dashboards/:id/panels` endpoint SHALL include a `dataAsOf: string | null` field
on every `PanelResponse`, computed server-side. When a panel is bound to a DataType whose
associated pipeline has run successfully, `dataAsOf` SHALL be the ISO-8601 timestamp of that
run's `last_run_at`. Otherwise, `dataAsOf` SHALL be absent or `null` in the response.

#### Scenario: Panel response includes dataAsOf when pipeline has run successfully
- **WHEN** a panel has been bound to a DataType and that DataType's associated pipeline has `last_run_status = 'succeeded'`
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `dataAsOf` set to an ISO-8601 timestamp

#### Scenario: Panel response omits dataAsOf for unbound panel
- **WHEN** a panel has no bound DataType (typeId is absent or empty)
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `dataAsOf` absent or `null`

#### Scenario: Panel response omits dataAsOf when pipeline has only failed runs
- **WHEN** a panel is bound to a DataType whose pipeline has only failed or never-run status
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `dataAsOf` absent or `null`
