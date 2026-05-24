# rls-sharing-aware-tables Specification

## Purpose
TBD - created by archiving change rls-sharing-aware-tables. Update Purpose after archive.
## Requirements
### Requirement: Dashboards table has FORCE RLS with sharing-aware SELECT policy
The system SHALL enable FORCE ROW LEVEL SECURITY on the `dashboards` table. The
SELECT policy SHALL permit a row to be visible when ANY of the following is true:
(a) `current_setting('app.current_user_id', true)::uuid = dashboards.owner_id` (owner),
(b) a named grant exists in `resource_permissions` where `resource_type = 'dashboard'`,
`resource_id = dashboards.id`, and `grantee_id = current_setting('app.current_user_id', true)::uuid`,
(c) `current_setting('app.current_user_id', true) IS NULL` AND a public-viewer grant exists
(`grantee_id IS NULL AND role = 'viewer'`). The privileged pool (helio_privileged BYPASSRLS)
SHALL bypass this policy.

#### Scenario: Owner sees own dashboards
- **WHEN** the app pool executes a SELECT on `dashboards` with `app.current_user_id` set to the owner
- **THEN** only dashboards owned by that user are returned

#### Scenario: Named grantee sees shared dashboard
- **WHEN** the app pool executes a SELECT on `dashboards` with `app.current_user_id` set to a named grantee
- **THEN** dashboards where a matching grant exists in `resource_permissions` are returned

#### Scenario: Anonymous caller sees only public dashboards
- **WHEN** the app pool executes a SELECT on `dashboards` with NO `app.current_user_id` set
- **THEN** only dashboards with a public-viewer grant (`grantee_id IS NULL, role = 'viewer'`) are returned

#### Scenario: Non-grantee sees no dashboards
- **WHEN** the app pool executes a SELECT on `dashboards` with `app.current_user_id` set to a user with no grant
- **THEN** zero rows are returned for dashboards not owned by that user

#### Scenario: Privileged pool bypasses policy
- **WHEN** a query executes via the helio_privileged pool (BYPASSRLS)
- **THEN** all dashboards are returned regardless of ownership or grants

### Requirement: Dashboards table has owner-and-editor UPDATE policy and owner-only DELETE policy
The dashboards UPDATE policy SHALL permit writes when the caller is the owner OR has an
editor-role grant. The DELETE policy SHALL permit deletion only when the caller is the owner.
Both policies apply only to the app pool; the privileged pool bypasses them.

#### Scenario: Owner can UPDATE dashboard
- **WHEN** the app pool executes an UPDATE on a dashboard with `app.current_user_id` set to the owner
- **THEN** the update succeeds

#### Scenario: Editor grantee can UPDATE dashboard
- **WHEN** the app pool executes an UPDATE on a dashboard with `app.current_user_id` set to an editor grantee
- **THEN** the update succeeds

#### Scenario: Viewer grantee cannot UPDATE dashboard
- **WHEN** the app pool executes an UPDATE on a dashboard with `app.current_user_id` set to a viewer grantee
- **THEN** zero rows are affected (policy blocks the update)

#### Scenario: Only owner can DELETE dashboard
- **WHEN** the app pool executes a DELETE on a dashboard with `app.current_user_id` set to a non-owner
- **THEN** zero rows are affected regardless of any grants held

### Requirement: Panels table has FORCE RLS delegating to dashboard ACL
The system SHALL enable FORCE ROW LEVEL SECURITY on the `panels` table. A SECURITY DEFINER
function `helio_can_access_dashboard(dashboard_id TEXT)` SHALL encode the dashboard SELECT
predicate; the panels SELECT policy SHALL use this function to inherit dashboard visibility.
The panels DELETE policy SHALL restrict to the parent dashboard's owner only.

#### Scenario: Owner sees own panels
- **WHEN** the app pool queries panels with `app.current_user_id` set to the dashboard owner
- **THEN** panels belonging to that owner's dashboards are returned

#### Scenario: Grantee sees panels on shared dashboard
- **WHEN** the app pool queries panels with `app.current_user_id` set to a named grantee
- **THEN** panels belonging to the shared dashboard are returned

#### Scenario: Non-grantee sees no panels
- **WHEN** the app pool queries panels with `app.current_user_id` set to a user with no grant
- **THEN** zero rows are returned for panels on dashboards not accessible to that user

### Requirement: resource_permissions table has FORCE RLS with grantor-and-grantee SELECT policy
The system SHALL enable FORCE ROW LEVEL SECURITY on the `resource_permissions` table.
The SELECT policy SHALL permit a row to be visible when the caller is the resource owner
(determined by joining to `dashboards.owner_id`) OR the named grantee. INSERT, UPDATE,
and DELETE SHALL be restricted to the resource owner only. Grants SHALL NOT leak to
unrelated users.

#### Scenario: Dashboard owner sees all grants for own dashboard
- **WHEN** the app pool queries resource_permissions with `app.current_user_id` set to the dashboard owner
- **THEN** all grant rows for that dashboard are returned

#### Scenario: Grantee sees own grant row
- **WHEN** the app pool queries resource_permissions with `app.current_user_id` set to a grantee
- **THEN** only grant rows where that user is the grantee are returned

#### Scenario: Unrelated user sees no grant rows
- **WHEN** the app pool queries resource_permissions with `app.current_user_id` set to a user who is neither owner nor grantee
- **THEN** zero rows are returned

#### Scenario: Only owner can INSERT grants
- **WHEN** the app pool attempts to INSERT into resource_permissions with `app.current_user_id` NOT equal to the dashboard owner
- **THEN** the insert fails (policy blocks it)

