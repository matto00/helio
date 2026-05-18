# acl-enforcement Specification

## Purpose
Defines the ACL directive that enforces resource ownership and sharing grants on all mutating and sensitive API routes. Covers ownership checks, shared access levels (Owner/Editor/Viewer), and decoupled resolver injection via the ResourceTypeRegistry.
## Requirements
### Requirement: ACL directive enforces resource ownership before handler execution
The system SHALL provide an Akka HTTP directive `authorizeResource(resourceType, resourceId, user)` that resolves
the resource owner from the appropriate repository and compares it with `user.id`. If the resource is not found
the directive SHALL reject with `404 Not Found`. If the resource exists but is owned by a different user the
directive SHALL reject with `403 Forbidden` and body `{"error": "Forbidden"}`. Only when the owner matches SHALL
the inner route handler execute.

The system SHALL additionally provide `authorizeResourceWithSharing(resourceId, userOpt, ownerResolver, permChecker)`
which returns a `ResourceAccess` value (`Owner | Editor | Viewer`) to the inner route. For unauthenticated
requests (`userOpt = None`) it checks for a public viewer grant via `permChecker` and passes `Viewer` if
found, or completes `404 Not Found` if not found (resource not revealed). For authenticated non-owners it
checks `resource_permissions` for the caller's user ID and returns the appropriate `ResourceAccess` level, or
`403 Forbidden` if no grant exists.

#### Scenario: Owner accesses their own resource
- **WHEN** a request targets a resource whose `ownerId` matches the authenticated user's ID
- **THEN** the inner route handler executes with `ResourceAccess = Owner`

#### Scenario: Non-owner is denied with 403
- **WHEN** a request targets a resource that exists and the authenticated user has no grant
- **THEN** the server responds with `403 Forbidden`
- **THEN** the response body is `{"error": "Forbidden"}`

#### Scenario: Unknown resource ID returns 404
- **WHEN** a request targets a resource ID that does not exist in the database
- **THEN** the server responds with `404 Not Found`
- **THEN** the response body is `{"error": "Dashboard not found"}` or `{"error": "Panel not found"}` as appropriate

#### Scenario: Authenticated editor receives Editor access level
- **WHEN** a non-owner authenticated user has an `editor` grant on the resource
- **THEN** the inner route handler executes with `ResourceAccess = Editor`

#### Scenario: Authenticated viewer receives Viewer access level
- **WHEN** a non-owner authenticated user has a `viewer` grant on the resource
- **THEN** the inner route handler executes with `ResourceAccess = Viewer`

#### Scenario: Unauthenticated request on public resource receives Viewer access
- **WHEN** an unauthenticated request targets a resource with a public viewer grant (grantee_id IS NULL)
- **THEN** the inner route handler executes with `ResourceAccess = Viewer`

#### Scenario: Unauthenticated request on non-public resource returns 404
- **WHEN** an unauthenticated request targets a resource without a public viewer grant
- **THEN** the server responds with `404 Not Found`

### Requirement: ACL directive is decoupled from resource types via a resolver registry
The directive SHALL accept a `ResourceTypeRegistry` (injected at construction) and use it to look up
the ownership resolver for a given resource type key. Callers pass `resourceType: String` and
`resourceId: String` instead of a raw resolver function. Adding support for a new resource type SHALL
require registering a single `ResourceType` entry in the registry — no copy-paste of ACL logic and no
changes to `AclDirective`.

If the registry does not contain the requested resource type key, `AclDirective` SHALL complete with
`500 Internal Server Error` and log an error.

#### Scenario: New resource type registered without modifying directive
- **WHEN** a new resolver is registered for a new resource type in the `ResourceTypeRegistry` passed to `AclDirective`
- **THEN** the existing `authorizeResource` directive enforces ownership for that type without code changes to the directive itself

#### Scenario: Unknown resource type key returns 500
- **WHEN** a route calls `authorizeResource` with a resource type key not present in the registry
- **THEN** the directive completes with `500 Internal Server Error`

### Requirement: PATCH and DELETE dashboard routes require ACL
`PATCH /api/dashboards/:id` and `DELETE /api/dashboards/:id` SHALL enforce ownership with
existence-not-leaked semantics.

- A user with no access grant receives `404 Not Found` (resource existence is not revealed).
- A user with a `viewer` grant (visible but not owner) receives `403 Forbidden`.
- A user with an `editor` grant may use `PATCH` but not `DELETE`.
- The owner may use both.

#### Scenario: Owner can patch their dashboard
- **WHEN** the owner sends `PATCH /api/dashboards/:id`
- **THEN** the patch is applied and the updated dashboard is returned

#### Scenario: No-grant user receives 404 on PATCH
- **WHEN** a user with no grant sends `PATCH /api/dashboards/:id`
- **THEN** the server responds with `404 Not Found`

#### Scenario: Viewer-grant user receives 403 on PATCH
- **WHEN** a user with a viewer grant sends `PATCH /api/dashboards/:id`
- **THEN** the server responds with `403 Forbidden`

#### Scenario: Owner can delete their dashboard
- **WHEN** the owner sends `DELETE /api/dashboards/:id`
- **THEN** the dashboard is deleted and `204 No Content` is returned

#### Scenario: No-grant user receives 404 on DELETE
- **WHEN** a user with no grant sends `DELETE /api/dashboards/:id`
- **THEN** the server responds with `404 Not Found`

#### Scenario: Grantee receives 403 on DELETE
- **WHEN** a user with a viewer or editor grant sends `DELETE /api/dashboards/:id`
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
`GET /api/dashboards/:id/export`, and `POST /api/dashboards/:id/duplicate`.

`GET /api/dashboards/:id/panels` uses the sharing-aware directive:
- Users with no grant receive `403 Forbidden` (directive confirms resource exists then checks grant).
- Owner and grantees (editor/viewer) receive the panel list.
- Unauthenticated requests on non-public dashboards receive `404 Not Found`.

`GET /api/dashboards/:id/export` and `POST /api/dashboards/:id/duplicate` use
existence-not-leaked semantics via the sharing-aware service read:
- Users with no grant receive `404 Not Found`.
- Users with a `viewer` grant receive `403 Forbidden` (visible but not authorized for that operation).
- Owner and editor grantees may proceed.

#### Scenario: Owner can list panels for their dashboard
- **WHEN** the owner sends `GET /api/dashboards/:id/panels`
- **THEN** the panels are returned

#### Scenario: No-grant authenticated user receives 403 on panel list
- **WHEN** an authenticated user with no grant sends `GET /api/dashboards/:id/panels`
- **THEN** the server responds with `403 Forbidden`

#### Scenario: Owner can export their dashboard
- **WHEN** the owner sends `GET /api/dashboards/:id/export`
- **THEN** the export snapshot is returned

#### Scenario: No-grant user receives 404 on export
- **WHEN** a user with no grant sends `GET /api/dashboards/:id/export`
- **THEN** the server responds with `404 Not Found`

#### Scenario: Viewer-grant user receives 403 on export
- **WHEN** a user with a viewer grant sends `GET /api/dashboards/:id/export`
- **THEN** the server responds with `403 Forbidden`

#### Scenario: Owner can duplicate their dashboard
- **WHEN** the owner sends `POST /api/dashboards/:id/duplicate`
- **THEN** the duplicate is created and returned

#### Scenario: No-grant user receives 404 on duplicate
- **WHEN** a user with no grant sends `POST /api/dashboards/:id/duplicate`
- **THEN** the server responds with `404 Not Found`

#### Scenario: Grantee receives 403 on duplicate
- **WHEN** a user with any grant sends `POST /api/dashboards/:id/duplicate`
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
- **WHEN** `DataSourceRepository.findByIdInternal` returns `Some(source)` and `authorizeResource` is called
- **THEN** the resolver returns `Some(source.ownerId.value)`

#### Scenario: DataType resolver returns owner id
- **WHEN** `DataTypeRepository.findByIdInternal` returns `Some(dt)` and `authorizeResource` is called
- **THEN** the resolver returns `Some(dt.ownerId.value)`

#### Scenario: Non-owner is denied DataSource access with 404
- **WHEN** a user calls a per-id data-source route (`PATCH`, `DELETE`, preview, refresh) for a source they do not own
- **THEN** the response is `404 Not Found` (existence-not-leaked semantics; no `403`)

#### Scenario: Non-owner is denied DataType access with 404
- **WHEN** a user calls `PATCH /api/types/:id` or `DELETE /api/types/:id` for a type they do not own
- **THEN** the response is `404 Not Found` (existence-not-leaked semantics; no `403`)

