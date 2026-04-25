# acl-resource-type-registry Specification

## Purpose
TBD - created by archiving change acl-resource-type-registry. Update Purpose after archive.
## Requirements
### Requirement: ResourceType encapsulates a resource type key and its ownership resolver
The system SHALL provide a `ResourceType` case class in `com.helio.api` with:
- `key: String` — a non-empty string identifying the resource type (e.g. `"dashboard"`, `"panel"`)
- `ownerResolver: String => Future[Option[String]]` — a function that maps a resource ID to the
  owner's user ID, returning `None` if the resource does not exist

#### Scenario: ResourceType constructed with valid key
- **WHEN** a `ResourceType` is constructed with `key = "dashboard"` and a valid resolver
- **THEN** the instance is created without error and `key` returns `"dashboard"`

### Requirement: ResourceTypeRegistry holds all registered types and validates at construction
The system SHALL provide a `ResourceTypeRegistry` class in `com.helio.api` that:
- Accepts a `Seq[ResourceType]` at construction time
- Throws `IllegalArgumentException` at construction if any two entries share the same `key`
- Provides a `lookup(key: String): Option[ResourceType]` method

#### Scenario: Registry with unique keys constructs successfully
- **WHEN** a `ResourceTypeRegistry` is constructed with entries having distinct keys
- **THEN** the registry is created without error

#### Scenario: Registry with duplicate keys fails fast at startup
- **WHEN** a `ResourceTypeRegistry` is constructed with two entries sharing the same key
- **THEN** an `IllegalArgumentException` is thrown before the server binds any port

#### Scenario: Lookup returns the registered type by key
- **WHEN** `registry.lookup("dashboard")` is called and `"dashboard"` was registered
- **THEN** the matching `ResourceType` is returned wrapped in `Some`

#### Scenario: Lookup returns None for unknown key
- **WHEN** `registry.lookup("report")` is called and no `"report"` type is registered
- **THEN** `None` is returned

### Requirement: Four built-in resource types are registered at startup
The system SHALL register the following resource types in `ApiRoutes` when constructing the
`ResourceTypeRegistry`:
- `"dashboard"` — resolved via `DashboardRepository.findById`
- `"panel"` — resolved via `PanelRepository.findById`
- `"data-source"` — resolved via `DataSourceRepository.findById`
- `"data-type"` — resolved via `DataTypeRepository.findById`

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
- **THEN** `registry.lookup("data-type")` returns a `Some` containing the data-type resolver

### Requirement: Adding a new resource type requires only a registry entry
The system SHALL be designed so that plugging in a new resource type (e.g. `"report"`) requires only:
1. A repository that resolves the owner ID by resource ID
2. A single `ResourceType` entry added to the `ResourceTypeRegistry` constructor call in `ApiRoutes`

No modifications SHALL be required to `AclDirective`, `ResourceTypeRegistry`, or any existing route class.

#### Scenario: New resource type registered without modifying directive
- **WHEN** a new `ResourceType("report", reportRepo.resolveOwner)` is added to the registry in `ApiRoutes`
- **THEN** `AclDirective.authorizeResource` enforces ownership for `"report"` resources without any
  changes to the directive class itself

