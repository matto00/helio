## ADDED Requirements

### Requirement: Panel query endpoint is the canonical structured query representation
The `GET /api/panels/:id/query` endpoint SHALL be the canonical way to express what data a panel needs
from its backing DataType. The full DataType snapshot fetch (preview endpoints) remains for immediate
UI display; the query endpoint is for the Spark execution layer and future integrations.

#### Scenario: Query endpoint coexists with preview endpoints
- **WHEN** a panel has a non-null `typeId`
- **THEN** both `GET /api/data-sources/:id/preview` (for UI preview) and `GET /api/panels/:id/query`
  (for execution layer) are available and return independent representations
