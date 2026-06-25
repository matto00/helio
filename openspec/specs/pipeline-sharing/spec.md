# pipeline-sharing Specification

## Purpose
Sharing-grant layer for pipelines: viewer/editor/owner roles, permission management REST endpoints, RLS-enforced access policies, and a frontend share dialog — allowing collaborators to read or mutate a shared pipeline without being its owner.
## Requirements
### Requirement: Pipeline owner can manage sharing grants via permission endpoints
The system SHALL expose `/api/pipelines/:id/permissions` with GET, POST, and DELETE sub-routes.
Only the pipeline owner MAY call these endpoints. Non-owners SHALL receive `403 Forbidden`. Unknown
pipeline IDs SHALL receive `404 Not Found`. No public-viewer (anonymous) grants SHALL be supported
for pipelines.

#### Scenario: Owner can list grants
- **WHEN** the pipeline owner calls `GET /api/pipelines/:id/permissions`
- **THEN** the response is `200 OK` with the list of grant objects

#### Scenario: Non-owner cannot list grants
- **WHEN** an authenticated user who does not own the pipeline calls `GET /api/pipelines/:id/permissions`
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

### Requirement: Viewer grantee has read-only access to pipeline endpoints
An authenticated user with a `viewer` grant on a pipeline SHALL be allowed to call all GET endpoints
(`/api/pipelines/:id`, `/api/pipelines/:id/steps`, `/api/pipelines/:id/analyze`,
`/api/pipelines/:id/run-history`, `/api/pipelines/:id/run-events`) but SHALL NOT be allowed to mutate
steps, trigger runs, delete the pipeline, or manage permissions.

#### Scenario: Viewer can read pipeline detail
- **WHEN** a user with a viewer grant calls `GET /api/pipelines/:id`
- **THEN** the response is `200 OK` with the pipeline summary

#### Scenario: Viewer can list steps
- **WHEN** a user with a viewer grant calls `GET /api/pipelines/:id/steps`
- **THEN** the response is `200 OK` with the step list

#### Scenario: Viewer can read run history
- **WHEN** a user with a viewer grant calls `GET /api/pipelines/:id/run-history`
- **THEN** the response is `200 OK` with the run records

#### Scenario: Viewer can subscribe to SSE stream
- **WHEN** a user with a viewer grant calls `GET /api/pipelines/:id/run-events`
- **THEN** the response is `200 OK` with content-type `text/event-stream`

#### Scenario: Viewer cannot add a step
- **WHEN** a user with a viewer grant calls `POST /api/pipelines/:id/steps`
- **THEN** the response is `403 Forbidden`

#### Scenario: Viewer cannot trigger a run
- **WHEN** a user with a viewer grant calls `POST /api/pipelines/:id/run`
- **THEN** the response is `403 Forbidden`

#### Scenario: Viewer cannot delete the pipeline
- **WHEN** a user with a viewer grant calls `DELETE /api/pipelines/:id`
- **THEN** the response is `403 Forbidden`

#### Scenario: Viewer cannot rename the pipeline
- **WHEN** a user with a viewer grant calls `PATCH /api/pipelines/:id`
- **THEN** the response is `403 Forbidden`

#### Scenario: Viewer cannot manage permissions
- **WHEN** a user with a viewer grant calls `POST /api/pipelines/:id/permissions`
- **THEN** the response is `403 Forbidden`

### Requirement: Editor grantee can mutate steps and trigger runs but not delete or transfer
An authenticated user with an `editor` grant on a pipeline SHALL be allowed to call
`POST /api/pipelines/:id/steps`, `PATCH /api/pipeline-steps/:stepId`,
`DELETE /api/pipeline-steps/:stepId`, `POST /api/pipelines/:id/run` (including dry run), and
`GET /api/pipelines/:id/analyze`. An editor SHALL NOT be allowed to `DELETE /api/pipelines/:id`,
`PATCH /api/pipelines/:id` (rename), or call the permissions management endpoints.

#### Scenario: Editor can add a step
- **WHEN** a user with an editor grant calls `POST /api/pipelines/:id/steps` with a valid step body
- **THEN** the step is created and the response is `201 Created`

#### Scenario: Editor can patch a step
- **WHEN** a user with an editor grant calls `PATCH /api/pipeline-steps/:stepId`
- **THEN** the update is applied and the response is `200 OK`

#### Scenario: Editor can delete a step
- **WHEN** a user with an editor grant calls `DELETE /api/pipeline-steps/:stepId`
- **THEN** the step is removed and the response is `204 No Content`

#### Scenario: Editor can trigger a run
- **WHEN** a user with an editor grant calls `POST /api/pipelines/:id/run`
- **THEN** the run is started and the response is `200 OK`

#### Scenario: Editor cannot delete the pipeline
- **WHEN** a user with an editor grant calls `DELETE /api/pipelines/:id`
- **THEN** the response is `403 Forbidden`

#### Scenario: Editor cannot rename the pipeline
- **WHEN** a user with an editor grant calls `PATCH /api/pipelines/:id`
- **THEN** the response is `403 Forbidden`

#### Scenario: Editor cannot manage permissions
- **WHEN** a user with an editor grant calls `GET /api/pipelines/:id/permissions`
- **THEN** the response is `403 Forbidden`

### Requirement: Cross-user caller with no grant receives 404 (CS2 behavior preserved)
An authenticated user with no grant on a pipeline owned by another user SHALL receive `404 Not Found`
on all pipeline endpoints (existence and authorization indistinguishable), identical to the CS2 behavior.

#### Scenario: No-grant user receives 404 on GET
- **WHEN** a user with no grant calls `GET /api/pipelines/:id` for a pipeline owned by another user
- **THEN** the response is `404 Not Found`

#### Scenario: No-grant user receives 404 on DELETE
- **WHEN** a user with no grant calls `DELETE /api/pipelines/:id`
- **THEN** the response is `404 Not Found`

#### Scenario: No-grant user receives 404 on step mutation
- **WHEN** a user with no grant calls `POST /api/pipelines/:id/steps`
- **THEN** the response is `404 Not Found`

### Requirement: Frontend share dialog allows the pipeline owner to manage grants
The frontend SHALL provide a share dialog accessible from the pipeline detail page and pipeline list
table (owner-visible only) that allows the pipeline owner to view current grants, add a new grantee
by searching/entering user email with a role selector (viewer or editor), and revoke existing grants.

#### Scenario: Share button is visible to the pipeline owner
- **WHEN** the authenticated user is the pipeline owner and views the pipeline detail page
- **THEN** a Share button is visible in the page header or actions menu

#### Scenario: Share dialog shows current grantees
- **WHEN** the pipeline owner opens the share dialog
- **THEN** the dialog lists all current grantees with their roles

#### Scenario: Owner can add a grantee via the share dialog
- **WHEN** the owner enters a grantee user ID and selects a role then clicks "Grant access"
- **THEN** the backend is called with `POST /api/pipelines/:id/permissions` and the grantee appears in the list

#### Scenario: Owner can revoke a grant via the share dialog
- **WHEN** the owner clicks "Revoke" next to a grantee in the share dialog
- **THEN** the backend is called with `DELETE /api/pipelines/:id/permissions/:granteeId` and the row is removed

