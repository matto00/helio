## MODIFIED Requirements

### Requirement: Shared dashboard and panel metadata
The system SHALL expose a shared `meta` object on dashboard and panel resources containing `createdAt`, `lastUpdated`, and `createdBy`. The `createdBy` field SHALL be set to the authenticated user's ID at resource creation time. On the public panel-list route (`GET /api/dashboards/:id/panels`), `meta.createdBy` SHALL be omitted for any caller who is neither the dashboard's owner nor the panel's creator; `createdAt` and `lastUpdated` are always present.

#### Scenario: Dashboard responses include metadata
- **WHEN** the backend returns a dashboard resource
- **THEN** the response includes `meta.createdBy`
- **THEN** the response includes `meta.createdAt`
- **THEN** the response includes `meta.lastUpdated`

#### Scenario: Panel responses include metadata
- **WHEN** the backend returns a panel resource to its owner, its creator, or via an authenticated non-public route
- **THEN** the response includes `meta.createdBy`
- **THEN** the response includes `meta.createdAt`
- **THEN** the response includes `meta.lastUpdated`

#### Scenario: Public panel list omits createdBy for a non-owner
- **WHEN** an anonymous or non-owner caller lists a dashboard's panels via the public route
- **THEN** `meta.createdBy` is absent and `meta.createdAt` and `meta.lastUpdated` are present

#### Scenario: Schemas require the shared metadata shape
- **WHEN** dashboard or panel resources are validated against their JSON Schema contracts
- **THEN** the schema requires the shared `meta` object, `createdAt` and `lastUpdated`, and documents `createdBy` as optional (omitted for non-owner callers of the public panel list)

#### Scenario: createdBy reflects the authenticated user on new dashboards
- **WHEN** an authenticated user creates a new dashboard via `POST /api/dashboards`
- **THEN** the created dashboard's `meta.createdBy` equals the authenticated user's ID

#### Scenario: createdBy reflects the authenticated user on new panels
- **WHEN** an authenticated user creates a new panel via `POST /api/panels`
- **THEN** the created panel's `meta.createdBy` equals the authenticated user's ID
