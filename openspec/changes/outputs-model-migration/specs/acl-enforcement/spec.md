## REMOVED Requirements

### Requirement: ACL directive covers DataSource and DataType resource types
**Reason**: The `"data-type"` resource type is retired along with DataTypes (see
`acl-resource-type-registry`'s modified delta) — Outputs authorize via their owning pipeline, not an
independent resolver.
**Migration**: The DataSource half of this requirement is preserved verbatim in the ADDED requirement
below; a caller that needs Output-level authorization uses the pipeline's ACL.

## ADDED Requirements

### Requirement: ACL directive covers the DataSource resource type
The `authorizeResource` directive resolver registry SHALL include a resolver for the `DataSource`
resource type. Registering this resolver in `ApiRoutes` SHALL require no changes to the
`AclDirective` class itself. The `"data-type"` resource type no longer exists.

#### Scenario: DataSource resolver returns owner id
- **WHEN** `DataSourceRepository.findByIdInternal` returns `Some(source)` and `authorizeResource` is called
- **THEN** the resolver returns `Some(source.ownerId.value)`

#### Scenario: Non-owner is denied DataSource access with 404
- **WHEN** a user calls a per-id data-source route (`PATCH`, `DELETE`, preview, refresh) for a source they do not own
- **THEN** the response is `404 Not Found` (existence-not-leaked semantics; no `403`)
