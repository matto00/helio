# acl-enforcement Specification

## Purpose
TBD - created by archiving change acl-enforcement-api-routes. Update Purpose after archive.
## Requirements
### Requirement: ACL directive enforces resource ownership before handler execution
The system SHALL provide an Akka HTTP directive `authorizeResource(resourceType, resourceId, user)` that resolves
the resource owner from the appropriate repository and compares it with `user.id`. If the resource is not found
the directive SHALL reject with `404 Not Found`. If the resource exists but is owned by a different user the
directive SHALL reject with `403 Forbidden` and body `{"error": "Forbidden"}`. Only when the owner matches SHALL
the inner route handler execute.

#### Scenario: Owner accesses their own resource
- **WHEN** a request targets a resource whose `createdBy` matches the authenticated user's ID
- **THEN** the inner route handler executes normally

#### Scenario: Non-owner is denied with 403
- **WHEN** a request targets a resource that exists and whose `createdBy` does not match the authenticated user's ID
- **THEN** the server responds with `403 Forbidden`
- **THEN** the response body is `{"error": "Forbidden"}`

#### Scenario: Unknown resource ID returns 404
- **WHEN** a request targets a resource ID that does not exist in the database
- **THEN** the server responds with `404 Not Found`
- **THEN** the response body is `{"error": "Dashboard not found"}` or `{"error": "Panel not found"}` as appropriate

### Requirement: ACL directive is decoupled from resource types via a resolver registry
The directive SHALL accept a resolver function per resource type. Adding support for a new resource type SHALL
require registering a single resolver entry — no copy-paste of ACL logic.

#### Scenario: New resource type registered without modifying directive
- **WHEN** a new resolver is registered for a new resource type in `ApiRoutes`
- **THEN** the existing `authorizeResource` directive enforces ownership for that type without code changes to the directive itself

### Requirement: PATCH and DELETE dashboard routes require ACL
`PATCH /api/dashboards/:id` and `DELETE /api/dashboards/:id` SHALL require the authenticated user to own the
dashboard. Requests from non-owners SHALL be rejected with `403`.

#### Scenario: Owner can patch their dashboard
- **WHEN** the owner sends `PATCH /api/dashboards/:id`
- **THEN** the patch is applied and the updated dashboard is returned

#### Scenario: Non-owner cannot patch dashboard
- **WHEN** a user who does not own the dashboard sends `PATCH /api/dashboards/:id`
- **THEN** the server responds with `403 Forbidden`

#### Scenario: Owner can delete their dashboard
- **WHEN** the owner sends `DELETE /api/dashboards/:id`
- **THEN** the dashboard is deleted and `204 No Content` is returned

#### Scenario: Non-owner cannot delete dashboard
- **WHEN** a user who does not own the dashboard sends `DELETE /api/dashboards/:id`
- **THEN** the server responds with `403 Forbidden`

### Requirement: PATCH and DELETE panel routes require ACL
`PATCH /api/panels/:id` and `DELETE /api/panels/:id` SHALL require the authenticated user to own the panel.
Requests from non-owners SHALL be rejected with `403`.

#### Scenario: Owner can patch their panel
- **WHEN** the owner sends `PATCH /api/panels/:id`
- **THEN** the patch is applied and the updated panel is returned

#### Scenario: Non-owner cannot patch panel
- **WHEN** a user who does not own the panel sends `PATCH /api/panels/:id`
- **THEN** the server responds with `403 Forbidden`

#### Scenario: Owner can delete their panel
- **WHEN** the owner sends `DELETE /api/panels/:id`
- **THEN** the panel is deleted and `204 No Content` is returned

#### Scenario: Non-owner cannot delete panel
- **WHEN** a user who does not own the panel sends `DELETE /api/panels/:id`
- **THEN** the server responds with `403 Forbidden`

### Requirement: Sensitive GET routes for dashboards require ACL
The system SHALL enforce ownership ACL on `GET /api/dashboards/:id/panels`,
`GET /api/dashboards/:id/export`, and `POST /api/dashboards/:id/duplicate`. Non-owners MUST receive `403`.

#### Scenario: Owner can list panels for their dashboard
- **WHEN** the owner sends `GET /api/dashboards/:id/panels`
- **THEN** the panels are returned

#### Scenario: Non-owner cannot list panels of another dashboard
- **WHEN** a non-owner sends `GET /api/dashboards/:id/panels`
- **THEN** the server responds with `403 Forbidden`

#### Scenario: Owner can export their dashboard
- **WHEN** the owner sends `GET /api/dashboards/:id/export`
- **THEN** the export snapshot is returned

#### Scenario: Non-owner cannot export another user's dashboard
- **WHEN** a non-owner sends `GET /api/dashboards/:id/export`
- **THEN** the server responds with `403 Forbidden`

#### Scenario: Owner can duplicate their dashboard
- **WHEN** the owner sends `POST /api/dashboards/:id/duplicate`
- **THEN** the duplicate is created and returned

#### Scenario: Non-owner cannot duplicate another user's dashboard
- **WHEN** a non-owner sends `POST /api/dashboards/:id/duplicate`
- **THEN** the server responds with `403 Forbidden`

### Requirement: Panel duplicate route requires ACL
`POST /api/panels/:id/duplicate` SHALL require the authenticated user to own the panel.

#### Scenario: Owner can duplicate their panel
- **WHEN** the owner sends `POST /api/panels/:id/duplicate`
- **THEN** the duplicate panel is created and returned

#### Scenario: Non-owner cannot duplicate another user's panel
- **WHEN** a non-owner sends `POST /api/panels/:id/duplicate`
- **THEN** the server responds with `403 Forbidden`

### Requirement: ACL directive is unit-testable in isolation
The `AclDirective` SHALL be testable without spinning up routes or a real database. It SHALL accept injected
resolver functions so tests can supply stubs.

#### Scenario: Unit test with owner resolver passes through
- **WHEN** the test injects a resolver returning `Some(userId)` matching the test user
- **THEN** the directive calls the inner route

#### Scenario: Unit test with non-owner resolver returns 403
- **WHEN** the test injects a resolver returning `Some(differentUserId)`
- **THEN** the directive completes with `403 Forbidden`

#### Scenario: Unit test with missing resource resolver returns 404
- **WHEN** the test injects a resolver returning `None`
- **THEN** the directive completes with `404 Not Found`

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

