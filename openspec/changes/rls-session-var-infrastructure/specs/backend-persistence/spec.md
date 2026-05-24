## MODIFIED Requirements

### Requirement: Repository layer isolates all database access
The backend SHALL route all dashboard, panel, data-type, data-source, and pipeline reads and writes through repository classes via `DbContext`, with no direct `db.run(action)` calls in repository methods for ACL'd tables. Non-ACL'd repositories (`UserRepository`, `UserSessionRepository`, `UserPreferenceRepository`) MAY continue to use `db.run` directly. Internal privileged callers (e.g., `DemoData`, `SourceSchemaHealthCheck`, `ResourceTypeRegistry` owner-resolver) SHALL use `DbContext.withSystemContext`.

#### Scenario: Dashboard created via repository
- **WHEN** a POST /api/dashboards request is handled
- **THEN** the new dashboard is written to PostgreSQL via DashboardRepository using DbContext, and the persisted record is returned

#### Scenario: Panel created via repository
- **WHEN** a POST /api/panels request is handled
- **THEN** the new panel is written to PostgreSQL via PanelRepository using DbContext, and the persisted record is returned

#### Scenario: No raw db.run in ACL'd repositories
- **WHEN** the codebase is audited
- **THEN** `DashboardRepository`, `PanelRepository`, `DataTypeRepository`, `DataSourceRepository`, and `PipelineRepository` contain no direct `db.run(` calls — all execute through `DbContext`
