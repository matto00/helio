## MODIFIED Requirements

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

