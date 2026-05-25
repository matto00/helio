## MODIFIED Requirements

### Requirement: resource_permissions table persists per-resource grants
The system SHALL maintain a `resource_permissions` table with columns `resource_type` VARCHAR,
`resource_id` UUID, `grantee_id` UUID nullable (foreign key to users, NULL means public), and
`role` VARCHAR CHECK (`role IN ('viewer', 'editor')`). A partial unique index SHALL prevent
duplicate public grants per resource; a regular unique index SHALL prevent duplicate grants
for the same grantee per resource. The table SHALL have FORCE ROW LEVEL SECURITY enabled with
policies enforcing that only the resource owner (determined by joining to `dashboards.owner_id`)
and the named grantee can read their respective grant rows.

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

#### Scenario: Grant rows do not leak to unrelated users
- **WHEN** an unrelated authenticated user (neither owner nor grantee) queries resource_permissions
  at the DB layer
- **THEN** zero rows are returned (RLS policy enforces isolation)
