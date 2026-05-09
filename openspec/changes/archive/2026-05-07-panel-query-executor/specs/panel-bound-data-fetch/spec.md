## ADDED Requirements

### Requirement: POST /api/panels/:id/execute is the Spark execution path for panel data
The `POST /api/panels/:id/execute` endpoint SHALL coexist with the existing DataType snapshot
preview endpoints. The preview endpoints (`GET /api/data-sources/:id/preview`, `GET /api/sources/:id/preview`)
remain for immediate UI display. The execute endpoint is intended for the Spark execution layer and
future integrations where full query semantics (field selection, filters, sort, limit) are required.

#### Scenario: Execute endpoint coexists with preview endpoints for bound panels
- **WHEN** a panel has a non-null `typeId` bound to a static or CSV DataSource
- **THEN** both `GET /api/data-sources/:id/preview` (UI preview) and
  `POST /api/panels/:id/execute` (Spark execution) are available and return independent representations
