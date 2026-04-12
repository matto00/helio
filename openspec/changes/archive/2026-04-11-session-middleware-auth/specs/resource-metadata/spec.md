## MODIFIED Requirements

### Requirement: Shared dashboard and panel metadata
The system SHALL expose a shared `meta` object on dashboard and panel resources containing `createdBy`, `createdAt`, and `lastUpdated`. The `createdBy` field SHALL be set to the authenticated user's ID at resource creation time.

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

#### Scenario: createdBy reflects the authenticated user on new dashboards
- **WHEN** an authenticated user creates a new dashboard via `POST /api/dashboards`
- **THEN** the created dashboard's `meta.createdBy` equals the authenticated user's ID

#### Scenario: createdBy reflects the authenticated user on new panels
- **WHEN** an authenticated user creates a new panel via `POST /api/panels`
- **THEN** the created panel's `meta.createdBy` equals the authenticated user's ID
