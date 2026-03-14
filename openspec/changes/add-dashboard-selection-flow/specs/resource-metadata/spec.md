## ADDED Requirements

### Requirement: Shared dashboard and panel metadata
The system SHALL expose a shared `meta` object on dashboard and panel resources containing `createdBy`, `createdAt`, and `lastUpdated`.

#### Scenario: Dashboard responses include metadata
- **WHEN** the backend returns a dashboard resource
- **THEN** the response includes `meta.createdBy`
- **THEN** the response includes `meta.createdAt`
- **THEN** the response includes `meta.lastUpdated`

#### Scenario: Panel responses include metadata
- **WHEN** the backend returns a panel resource
- **THEN** the response includes `meta.createdBy`
- **THEN** the response includes `meta.createdAt`
- **THEN** the response includes `meta.lastUpdated`

#### Scenario: Schemas require the shared metadata shape
- **WHEN** dashboard or panel resources are validated against their JSON Schema contracts
- **THEN** the schema requires the shared `meta` object and its required fields
