## MODIFIED Requirements

### Requirement: Permission management endpoints are owner-only
The permission management endpoints SHALL be restricted to the dashboard owner. Specifically,
`POST /api/dashboards/:id/permissions`, `DELETE /api/dashboards/:id/permissions/:granteeId`,
and `GET /api/dashboards/:id/permissions` SHALL require the authenticated user to be the
dashboard owner. A non-owner with no grant on the dashboard SHALL receive `404 Not Found`, byte-identical to the response for a nonexistent dashboard (HEL-1002, existence not leaked); a grantee (who already sees the dashboard) SHALL receive `403 Forbidden`.

#### Scenario: Owner can list grants
- **WHEN** the owner calls `GET /api/dashboards/:id/permissions`
- **THEN** the response is `200 OK` with all grants for the dashboard

#### Scenario: Non-owner cannot list grants
- **WHEN** an authenticated user with no grant calls `GET /api/dashboards/:id/permissions`
- **THEN** the response is `404 Not Found`, identical in status and body to a nonexistent dashboard id

#### Scenario: Grantee cannot list grants
- **WHEN** a user with a viewer or editor grant calls `GET /api/dashboards/:id/permissions`
- **THEN** the response is `403 Forbidden`

#### Scenario: Non-owner cannot grant access
- **WHEN** a non-owner with no grant calls `POST /api/dashboards/:id/permissions`
- **THEN** the response is `404 Not Found` (a grantee receives `403 Forbidden`)

#### Scenario: Non-owner cannot revoke access
- **WHEN** a non-owner with no grant calls `DELETE /api/dashboards/:id/permissions/:granteeId`
- **THEN** the response is `404 Not Found` (a grantee receives `403 Forbidden`)
