# resource-permissions Specification

## Purpose
TBD - created by archiving change acl-sharing-permissions. Update Purpose after archive.
## Requirements
### Requirement: resource_permissions table persists per-resource grants
The system SHALL maintain a `resource_permissions` table with columns `resource_type` VARCHAR,
`resource_id` UUID, `grantee_id` UUID nullable (foreign key to users, NULL means public), and
`role` VARCHAR CHECK (`role IN ('viewer', 'editor')`). A partial unique index SHALL prevent
duplicate public grants per resource; a regular unique index SHALL prevent duplicate grants
for the same grantee per resource.

#### Scenario: Grant row inserted
- **WHEN** an owner calls `POST /api/dashboards/:id/permissions` with a valid grantee and role
- **THEN** a row is inserted into `resource_permissions` with `resource_type = 'dashboard'`,
  `resource_id = :id`, `grantee_id`, and `role`
- **THEN** the response is `201 Created` with the grant details

#### Scenario: Duplicate grant rejected
- **WHEN** an owner calls `POST /api/dashboards/:id/permissions` for the same grantee twice
- **THEN** the server responds with `409 Conflict`

#### Scenario: Grant row deleted
- **WHEN** an owner calls `DELETE /api/dashboards/:id/permissions/:granteeId`
- **THEN** the matching row is deleted from `resource_permissions`
- **THEN** the response is `204 No Content`

#### Scenario: Public grant created with null grantee
- **WHEN** an owner calls `POST /api/dashboards/:id/permissions` with body `{"role": "viewer"}` and no granteeId
- **THEN** a row is inserted with `grantee_id = NULL` and `role = 'viewer'`
- **THEN** the response is `201 Created`

### Requirement: Permission management endpoints are owner-only
The permission management endpoints SHALL be restricted to the dashboard owner. Specifically,
`POST /api/dashboards/:id/permissions`, `DELETE /api/dashboards/:id/permissions/:granteeId`,
and `GET /api/dashboards/:id/permissions` SHALL require the authenticated user to be the
dashboard owner. Non-owners SHALL receive `403 Forbidden`.

#### Scenario: Owner can list grants
- **WHEN** the owner calls `GET /api/dashboards/:id/permissions`
- **THEN** the response is `200 OK` with all grants for the dashboard

#### Scenario: Non-owner cannot list grants
- **WHEN** a non-owner authenticated user calls `GET /api/dashboards/:id/permissions`
- **THEN** the response is `403 Forbidden`

#### Scenario: Non-owner cannot grant access
- **WHEN** a non-owner calls `POST /api/dashboards/:id/permissions`
- **THEN** the response is `403 Forbidden`

#### Scenario: Non-owner cannot revoke access
- **WHEN** a non-owner calls `DELETE /api/dashboards/:id/permissions/:granteeId`
- **THEN** the response is `403 Forbidden`

### Requirement: Editors may modify panels but not the dashboard or its permissions
An authenticated user with an `editor` grant on a dashboard SHALL be allowed to call panel
mutation routes (`PATCH /api/panels/:id`, `POST /api/panels/:id/duplicate`,
`DELETE /api/panels/:id`, `POST /api/panels`) but SHALL NOT be allowed to `PATCH`, `DELETE`,
or change permissions of the dashboard itself.

#### Scenario: Editor can patch a panel
- **WHEN** a user with editor grant on dashboard D calls `PATCH /api/panels/:panelId` for a panel on D
- **THEN** the patch is applied and the updated panel is returned

#### Scenario: Editor cannot delete the dashboard
- **WHEN** a user with editor grant on dashboard D calls `DELETE /api/dashboards/:id`
- **THEN** the response is `403 Forbidden`

#### Scenario: Editor cannot patch the dashboard
- **WHEN** a user with editor grant calls `PATCH /api/dashboards/:id`
- **THEN** the response is `403 Forbidden`

#### Scenario: Editor cannot manage permissions
- **WHEN** a user with editor grant calls `POST /api/dashboards/:id/permissions`
- **THEN** the response is `403 Forbidden`

### Requirement: Viewers have read-only access to dashboards and their panels
An authenticated user with a `viewer` grant on a dashboard SHALL be allowed to call
`GET /api/dashboards/:id/panels` but SHALL NOT be allowed to modify the dashboard, its panels,
or its permissions.

#### Scenario: Viewer can read panels
- **WHEN** a user with viewer grant on dashboard D calls `GET /api/dashboards/:id/panels`
- **THEN** the panels list is returned

#### Scenario: Viewer cannot patch a panel
- **WHEN** a user with viewer grant calls `PATCH /api/panels/:panelId`
- **THEN** the response is `403 Forbidden`

#### Scenario: Viewer cannot create a panel on the dashboard
- **WHEN** a user with viewer grant calls `POST /api/panels` with `dashboardId` = D
- **THEN** the response is `403 Forbidden`

### Requirement: Public dashboards are accessible without authentication
The system SHALL allow unauthenticated access to dashboards that have a `resource_permissions`
row with `grantee_id IS NULL` and `role = 'viewer'`. Such dashboards SHALL be accessible via
`GET /api/dashboards/:id/panels` without an `Authorization` header. All mutating routes SHALL
remain auth-required even for public dashboards.

#### Scenario: Unauthenticated request can read panels of public dashboard
- **WHEN** an unauthenticated request calls `GET /api/dashboards/:id/panels` on a public dashboard
- **THEN** the response is `200 OK` with the panels list

#### Scenario: Unauthenticated request cannot modify a public dashboard
- **WHEN** an unauthenticated request calls `PATCH /api/dashboards/:id`
- **THEN** the response is `401 Unauthorized`

#### Scenario: Unauthenticated request on non-public dashboard returns 404
- **WHEN** an unauthenticated request calls `GET /api/dashboards/:id/panels` on a non-public dashboard
- **THEN** the response is `404 Not Found` (resource not revealed to unauthenticated callers)

