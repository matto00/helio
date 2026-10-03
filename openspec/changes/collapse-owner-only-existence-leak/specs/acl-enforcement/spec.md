## ADDED Requirements

### Requirement: ACL directive enforces ownership with existence-not-leaked denial
The system SHALL provide an Akka HTTP directive `authorizeResource(resourceType, resourceId, user)` that resolves
the resource owner from the appropriate repository and compares it with `user.id`. If the resource is not found
the directive SHALL reject with `404 Not Found`. If the resource exists but is owned by a different user the
directive SHALL reject with `404 Not Found` using the same status and byte-identical serialized body as the
resource-not-found case (existence-not-leaked semantics). Only when the owner matches SHALL
the inner route handler execute.

The system SHALL additionally provide `authorizeResourceWithSharing(resourceId, userOpt, ownerResolver, permChecker)`
which returns a `ResourceAccess` value (`Owner | Editor | Viewer`) to the inner route. For unauthenticated
requests (`userOpt = None`) it checks for a public viewer grant via `permChecker` and passes `Viewer` if
found, or completes `404 Not Found` if not found (resource not revealed). For authenticated non-owners it
checks `resource_permissions` for the caller's user ID and returns the appropriate `ResourceAccess` level, or
`404 Not Found` (same status and byte-identical body as the resource-absent case) if no grant exists.

The service-layer `AccessChecker.requireOwnerOnly` and `AccessChecker.requireAccess` SHALL apply the same
rule: a caller with no grant at all on a real resource receives the identical `NotFound` (same message) that an
absent resource produces. A caller who holds a grant (and therefore already knows the resource exists) but lacks
the privilege for the operation SHALL still receive `403 Forbidden`.

#### Scenario: Owner accesses their own resource
- **WHEN** a request targets a resource whose `ownerId` matches the authenticated user's ID
- **THEN** the inner route handler executes with `ResourceAccess = Owner`

#### Scenario: Non-owner with no grant is denied as not-found
- **WHEN** a request targets a resource that exists and the authenticated user has no grant
- **THEN** the server responds with `404 Not Found`
- **THEN** the serialized response body is byte-identical to the body for a nonexistent id on the same route

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

#### Scenario: Grantee lacking privilege still receives 403
- **WHEN** a caller with a `viewer` grant attempts an owner-only or editor-only operation
- **THEN** the server responds with `403 Forbidden`

### Requirement: Sensitive dashboard GET routes deny no-grant callers as not-found
The system SHALL enforce ownership ACL on `GET /api/dashboards/:id/panels`,
`GET /api/dashboards/:id/export`, and `POST /api/dashboards/:id/duplicate`.

`GET /api/dashboards/:id/panels` uses the sharing-aware directive:
- Users with no grant receive `404 Not Found` with the same body as an absent dashboard.
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

#### Scenario: No-grant authenticated user receives 404 on panel list
- **WHEN** an authenticated user with no grant sends `GET /api/dashboards/:id/panels`
- **THEN** the server responds with `404 Not Found` and the same body as for a nonexistent dashboard

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

### Requirement: Authenticated no-grant denial does not reveal resource existence
Every owner-only or grant-gated route SHALL answer an authenticated caller who holds no grant on a real resource
with exactly the response (status and serialized body) it gives for a nonexistent id. `403 Forbidden` SHALL be
reserved for denials where the caller already can see the resource (a `viewer` grant on an editor/owner operation,
a form-submit by a visible non-owner), tier gating (`TIER_FORBIDDEN`), and scoped-PAT confinement. Tests SHALL
assert this across every owner-only route, comparing serialized bodies.

#### Scenario: Foreign and nonexistent ids are indistinguishable on every owner-only route
- **WHEN** an authenticated caller requests an owner-only route once with a nonexistent id and once with an id owned by another user with no grant
- **THEN** both responses have status `404` and byte-identical bodies

#### Scenario: Share-token management routes collapse via the shared helper
- **WHEN** a non-owner calls a share-token management route for a real dashboard
- **THEN** the response is `404` with the same body as for an absent dashboard, produced by `requireOwnerOnly` itself with no service-local mapping

### Requirement: ACL directive is unit-testable with stubbed resolvers
The `AclDirective` SHALL be testable without spinning up routes or a real database. It SHALL accept injected
resolver functions so tests can supply stubs.

#### Scenario: Unit test with owner resolver passes through
- **WHEN** the test injects a resolver returning `Some(userId)` matching the test user
- **THEN** the directive calls the inner route

#### Scenario: Unit test with non-owner resolver returns 404
- **WHEN** the test injects a resolver returning `Some(differentUserId)`
- **THEN** the directive completes with `404 Not Found` and a body identical to the resolver-`None` case

#### Scenario: Unit test with missing resource resolver returns 404
- **WHEN** the test injects a resolver returning `None`
- **THEN** the directive completes with `404 Not Found`

## REMOVED Requirements

### Requirement: ACL directive is unit-testable in isolation
**Reason**: Replaced by a requirement whose non-owner scenario asserts 404 instead of 403.
**Migration**: See "ACL directive is unit-testable with stubbed resolvers".

### Requirement: ACL directive enforces resource ownership before handler execution
**Reason**: Replaced; the no-grant authenticated denial is now 404, not 403.
**Migration**: See "ACL directive enforces ownership with existence-not-leaked denial".

### Requirement: Sensitive GET routes for dashboards require ACL
**Reason**: Replaced; the no-grant panel-list denial is now 404, not 403.
**Migration**: See "Sensitive dashboard GET routes deny no-grant callers as not-found".
