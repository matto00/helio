# rls-privileged-dml-coverage Specification

## Purpose
Integration test suite verifying that helio_privileged has table-level DML capability (INSERT, UPDATE, DELETE) on all nine ACL'd tables and that withUserContext via a non-superuser app pool is RLS-filtered.
## Requirements
### Requirement: withSystemContext can INSERT on every ACL'd table
`withSystemContext` (running as `helio_privileged` with `BYPASSRLS`) SHALL be able to
INSERT rows into all nine ACL'd tables (`pipelines`, `pipeline_steps`, `pipeline_runs`,
`data_sources`, `data_types`, `data_type_rows`, `dashboards`, `panels`, `resource_permissions`)
without a `permission denied for table` error.

#### Scenario: helio_privileged INSERT on data_sources succeeds
- **WHEN** `withSystemContext` executes an INSERT on `data_sources`
- **THEN** the row is created and the row count is 1 (no permission error)

#### Scenario: helio_privileged INSERT on data_types succeeds
- **WHEN** `withSystemContext` executes an INSERT on `data_types`
- **THEN** the row is created and the row count is 1 (no permission error)

#### Scenario: helio_privileged INSERT on pipelines succeeds
- **WHEN** `withSystemContext` executes an INSERT on `pipelines`
- **THEN** the row is created and the row count is 1 (no permission error)

#### Scenario: helio_privileged INSERT on dashboards succeeds
- **WHEN** `withSystemContext` executes an INSERT on `dashboards`
- **THEN** the row is created and the row count is 1 (no permission error)

#### Scenario: helio_privileged INSERT on panels succeeds
- **WHEN** `withSystemContext` executes an INSERT on `panels`
- **THEN** the row is created and the row count is 1 (no permission error)

#### Scenario: helio_privileged INSERT on resource_permissions succeeds
- **WHEN** `withSystemContext` executes an INSERT on `resource_permissions`
- **THEN** the row is created and the row count is 1 (no permission error)

### Requirement: withSystemContext can UPDATE on every ACL'd table
`withSystemContext` SHALL be able to UPDATE rows on every ACL'd table it previously inserted.

#### Scenario: helio_privileged UPDATE on data_sources succeeds
- **WHEN** `withSystemContext` executes an UPDATE on a row it owns in `data_sources`
- **THEN** the update completes without a permission error

#### Scenario: helio_privileged UPDATE on dashboards succeeds
- **WHEN** `withSystemContext` executes an UPDATE on a row it owns in `dashboards`
- **THEN** the update completes without a permission error

### Requirement: withSystemContext can DELETE on every ACL'd table
`withSystemContext` SHALL be able to DELETE rows on every ACL'd table it previously inserted.

#### Scenario: helio_privileged DELETE on data_sources succeeds
- **WHEN** `withSystemContext` executes a DELETE on a row in `data_sources`
- **THEN** the row is removed without a permission error

#### Scenario: helio_privileged DELETE on dashboards succeeds
- **WHEN** `withSystemContext` executes a DELETE on a row in `dashboards`
- **THEN** the row is removed without a permission error

### Requirement: Two-role topology test uses a non-superuser app pool
The test harness for the privileged-DML coverage spec SHALL construct `DbContext` with:
- A privileged pool that uses `connectionInitSql = "SET ROLE helio_privileged"` (not a superuser).
- An app pool that uses `connectionInitSql = "SET ROLE helio_app_test"` (non-superuser, non-BYPASSRLS).

#### Scenario: Test harness app pool is not a superuser
- **WHEN** the `RlsPrivilegedDmlSpec` runs its beforeAll setup
- **THEN** the app pool's effective role is `helio_app_test`, which has no superuser or BYPASSRLS attribute

#### Scenario: Test harness privileged pool active role is helio_privileged
- **WHEN** `withSystemContext` queries `SELECT current_role`
- **THEN** the result is `helio_privileged`

### Requirement: withUserContext via non-superuser app pool is RLS-filtered
`withUserContext` run through a non-superuser app pool SHALL return only rows belonging to the
requesting user; rows belonging to other users SHALL be excluded by RLS policies.

#### Scenario: withUserContext(ownerA) does not see ownerB's rows on a non-superuser pool
- **WHEN** `withUserContext(ownerA)` queries `data_sources` after both ownerA and ownerB rows exist
- **THEN** only ownerA's row is returned; ownerB's row is excluded by RLS

