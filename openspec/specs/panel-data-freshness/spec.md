# panel-data-freshness Specification

## Purpose
Displays a "Data as of [relative time]" freshness indicator on panels bound to a DataType, sourced from the most recent successful pipeline run that writes to that DataType.

## Requirements

### Requirement: Panel wire carries dataAsOf as a backend-only field
The panel list response of `GET /api/dashboards/:id/panels` (the shared public/optional-auth panel-list route, including authenticated viewers of it) SHALL carry `dataAsOf` (the bound Output's pipeline `lastRunAt`, or null) for `OutputPanel`s. Other panel responses (create, update, dashboard contents, snapshot) carry null. No frontend indicator renders it; freshness is presented by the provenance read.

#### Scenario: Bound panel carries dataAsOf
- **WHEN** a panel bound to an Output whose pipeline has run is listed via `GET /api/dashboards/:id/panels`
- **THEN** `dataAsOf` equals the pipeline's last run timestamp
