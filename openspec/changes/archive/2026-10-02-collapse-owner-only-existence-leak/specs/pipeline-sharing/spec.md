## MODIFIED Requirements

### Requirement: Pipeline owner can manage sharing grants via permission endpoints
The system SHALL expose `/api/pipelines/:id/permissions` with GET, POST, and DELETE sub-routes.
Only the pipeline owner MAY call these endpoints. A non-owner with no grant SHALL receive `404 Not Found`, byte-identical to the
response for an unknown pipeline ID (HEL-1002, existence not leaked); a grantee SHALL receive `403 Forbidden`. No public-viewer (anonymous) grants SHALL be supported
for pipelines.

#### Scenario: Owner can list grants
- **WHEN** the pipeline owner calls `GET /api/pipelines/:id/permissions`
- **THEN** the response is `200 OK` with the list of grant objects

#### Scenario: Non-owner cannot list grants
- **WHEN** an authenticated user with no grant on the pipeline calls `GET /api/pipelines/:id/permissions`
- **THEN** the response is `404 Not Found`, identical in status and body to an unknown pipeline id

#### Scenario: Grantee cannot list grants
- **WHEN** an authenticated user with a viewer or editor grant calls `GET /api/pipelines/:id/permissions`
- **THEN** the response is `403 Forbidden`

#### Scenario: Owner can grant viewer role
- **WHEN** the owner calls `POST /api/pipelines/:id/permissions` with body `{"granteeId": "<uid>", "role": "viewer"}`
- **THEN** a grant row is inserted with `resource_type = 'pipeline'` and the response is `201 Created`

#### Scenario: Owner can grant editor role
- **WHEN** the owner calls `POST /api/pipelines/:id/permissions` with body `{"granteeId": "<uid>", "role": "editor"}`
- **THEN** a grant row is inserted with `resource_type = 'pipeline'` and the response is `201 Created`

#### Scenario: Duplicate grant is rejected
- **WHEN** the owner calls `POST /api/pipelines/:id/permissions` for the same grantee twice
- **THEN** the response is `409 Conflict`

#### Scenario: Owner can revoke a grant
- **WHEN** the owner calls `DELETE /api/pipelines/:id/permissions/:granteeId`
- **THEN** the grant row is deleted and the response is `204 No Content`

#### Scenario: Null grantee (public-viewer) grant is rejected
- **WHEN** the owner calls `POST /api/pipelines/:id/permissions` with no `granteeId` field
- **THEN** the response is `400 Bad Request` (no anonymous pipeline access)
