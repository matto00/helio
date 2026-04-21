## MODIFIED Requirements

### Requirement: ACL directive covers DataSource and DataType resource types
The `authorizeResource` directive resolver registry SHALL include resolvers for `DataSource` and
`DataType` resource types. Registering these resolvers in `ApiRoutes` SHALL require no changes to the
`AclDirective` class itself.

#### Scenario: DataSource resolver returns owner id
- **WHEN** `DataSourceRepository.findById` returns `Some(source)` and `authorizeResource` is called
- **THEN** the resolver returns `Some(source.ownerId.value)`

#### Scenario: DataType resolver returns owner id
- **WHEN** `DataTypeRepository.findById` returns `Some(dt)` and `authorizeResource` is called
- **THEN** the resolver returns `Some(dt.ownerId.value)`

#### Scenario: Non-owner is denied DataSource access with 403
- **WHEN** a user calls a per-id data-source route for a source they do not own
- **THEN** the response is `403 Forbidden` with body `{"error": "Forbidden"}`

#### Scenario: Non-owner is denied DataType access with 403
- **WHEN** a user calls `PATCH /api/types/:id` or `DELETE /api/types/:id` for a type they do not own
- **THEN** the response is `403 Forbidden` with body `{"error": "Forbidden"}`
