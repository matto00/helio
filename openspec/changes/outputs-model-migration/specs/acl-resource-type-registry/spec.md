## MODIFIED Requirements

### Requirement: Four built-in resource types are registered at startup
The system SHALL register the following resource types in `ApiRoutes` when constructing the
`ResourceTypeRegistry`:
- `"dashboard"` — resolved via `DashboardRepository.findById`
- `"panel"` — resolved via `PanelRepository.findById`
- `"data-source"` — resolved via `DataSourceRepository.findById`
- `"pipeline"` — resolved via `PipelineRepository.findById`

The `"data-type"` resource type (resolved via `DataTypeRepository.findById`) no longer exists.
Outputs are authorized through their owning pipeline (see `outputs-model`), not through a
separate resource-type entry — an Output has no independent ACL resolver.

The registry SHALL be injected into `AclDirective` and SHALL be the sole source of ownership
resolvers used by the directive.

#### Scenario: Dashboard type is registered
- **WHEN** the server starts
- **THEN** `registry.lookup("dashboard")` returns a `Some` containing the dashboard resolver

#### Scenario: Panel type is registered
- **WHEN** the server starts
- **THEN** `registry.lookup("panel")` returns a `Some` containing the panel resolver

#### Scenario: DataSource type is registered
- **WHEN** the server starts
- **THEN** `registry.lookup("data-source")` returns a `Some` containing the data-source resolver

#### Scenario: DataType type is registered
- **WHEN** the server starts
- **THEN** `registry.lookup("data-type")` returns `None` — the `"data-type"` resource type was
  retired by this migration and is no longer registered (see the requirement body above)
