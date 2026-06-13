## MODIFIED Requirements

### Requirement: resource_permissions table persists per-resource grants
The system SHALL maintain a `resource_permissions` table with columns `resource_type` VARCHAR,
`resource_id` UUID, `grantee_id` UUID nullable (foreign key to users, NULL means public), and
`role` VARCHAR CHECK (`role IN ('viewer', 'editor')`). A partial unique index SHALL prevent
duplicate public grants per resource; a regular unique index SHALL prevent duplicate grants
for the same grantee per resource. The table SHALL have FORCE ROW LEVEL SECURITY enabled with
policies enforcing that only the resource owner (determined by joining to `dashboards.owner_id`
for dashboard resources OR `pipelines.owner_id` for pipeline resources) and the named grantee
can read their respective grant rows.

The supported values for `resource_type` SHALL include `'dashboard'` and `'pipeline'`.
No anonymous/public grants SHALL be permitted for `resource_type = 'pipeline'`.

#### Scenario: Grant row inserted for a pipeline
- **WHEN** a pipeline owner calls `POST /api/pipelines/:id/permissions` with a valid grantee and role
- **THEN** a row is inserted into `resource_permissions` with `resource_type = 'pipeline'`,
  `resource_id = :id`, `grantee_id`, and `role`
- **THEN** the response is `201 Created` with the grant details

#### Scenario: Duplicate grant rejected
- **WHEN** an owner calls `POST /api/pipelines/:id/permissions` for the same grantee twice
- **THEN** the server responds with `409 Conflict`

#### Scenario: Grant row deleted for a pipeline
- **WHEN** an owner calls `DELETE /api/pipelines/:id/permissions/:granteeId`
- **THEN** the matching row is deleted from `resource_permissions`
- **THEN** the response is `204 No Content`

#### Scenario: Pipeline grant rows do not leak to unrelated users
- **WHEN** an unrelated authenticated user (neither owner nor grantee) queries resource_permissions
  for a pipeline at the DB layer
- **THEN** zero rows are returned (RLS policy enforces isolation)

#### Scenario: Grant row inserted for a dashboard (existing behavior preserved)
- **WHEN** an owner calls `POST /api/dashboards/:id/permissions` with a valid grantee and role
- **THEN** a row is inserted into `resource_permissions` with `resource_type = 'dashboard'`
- **THEN** the response is `201 Created` with the grant details
