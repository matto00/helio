# rls-owner-tables Specification

## Purpose
TBD - created by archiving change rls-enable-owner-tables. Update Purpose after archive.
## Requirements
### Requirement: All six owner-only tables have RLS enabled with an owner policy
The Flyway migration V35 SHALL enable `ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on
`pipelines`, `pipeline_steps`, `pipeline_runs`, `data_sources`, `data_types`, and `data_type_rows`.
Each table SHALL have exactly one `USING` policy named `<table>_owner` that restricts access to
rows whose effective owner matches `current_setting('app.current_user_id')::uuid`.

#### Scenario: Direct-owner table policy allows owner access
- **WHEN** a query runs inside `withUserContext(userId)` on `pipelines`, `data_sources`, or `data_types`
- **THEN** only rows where `owner_id = userId::uuid` are returned

#### Scenario: Indirect-owner table policy allows owner access via parent
- **WHEN** a query runs inside `withUserContext(userId)` on `pipeline_steps`, `pipeline_runs`, or `data_type_rows`
- **THEN** only rows whose parent pipeline or data_type is owned by `userId` are returned

#### Scenario: All six tables have RLS enabled after V35 migration
- **WHEN** Flyway applies V35 to a fresh database
- **THEN** `SELECT relrowsecurity FROM pg_class WHERE relname IN ('pipelines','pipeline_steps','pipeline_runs','data_sources','data_types','data_type_rows')` returns true for all six rows

### Requirement: App pool fail-closed when session variable is unset
Queries on RLS-protected tables SHALL raise an error when `app.current_user_id` is not set in the
transaction, rather than silently returning rows or granting access to all rows.

#### Scenario: No SET LOCAL yields an error on the app pool
- **WHEN** a query on a protected table runs on the app pool without a preceding `SET LOCAL app.current_user_id`
- **THEN** PostgreSQL raises an error (unset_config error or similar) rather than returning 0 rows silently

### Requirement: Cross-user isolation is enforced at the DB layer
A transaction bound to user A via `withUserContext` SHALL NOT be able to read or modify user B's rows,
even if the application-layer filter is absent.

#### Scenario: User A cannot read User B's pipelines
- **WHEN** `withUserContext(userA)` queries the `pipelines` table without any application-layer filter
- **THEN** only rows owned by userA are returned; userB's rows are excluded

#### Scenario: User A cannot read User B's data_sources
- **WHEN** `withUserContext(userA)` queries the `data_sources` table without any application-layer filter
- **THEN** only rows owned by userA are returned

#### Scenario: User A cannot read User B's data_types
- **WHEN** `withUserContext(userA)` queries the `data_types` table without any application-layer filter
- **THEN** only rows owned by userA are returned

#### Scenario: User A cannot read User B's pipeline_steps
- **WHEN** `withUserContext(userA)` queries the `pipeline_steps` table without any application-layer filter
- **THEN** only rows whose parent pipeline is owned by userA are returned

#### Scenario: User A cannot read User B's pipeline_runs
- **WHEN** `withUserContext(userA)` queries the `pipeline_runs` table without any application-layer filter
- **THEN** only rows whose parent pipeline is owned by userA are returned

#### Scenario: User A cannot read User B's data_type_rows
- **WHEN** `withUserContext(userA)` queries the `data_type_rows` table without any application-layer filter
- **THEN** only rows whose parent data_type is owned by userA are returned

### Requirement: Privileged pool bypasses all six table policies
The `withSystemContext` pool (helio_privileged BYPASSRLS) SHALL see all rows on all six tables
regardless of `app.current_user_id`.

#### Scenario: withSystemContext sees all rows across users
- **WHEN** `withSystemContext` queries any of the six RLS-protected tables
- **THEN** all rows from all owners are returned

### Requirement: Repository user-bound write paths enforce RLS
`DataSourceRepository.insert`, `update`, `updateStaticPayload`, and `delete` SHALL call
`withUserContext` so RLS policies apply on write for user-initiated operations.
`DataTypeRepository.insert`, `update`, and `delete` SHALL call `withUserContext`.
`PipelineStepRepository.insert` SHALL call `withUserContext`.

#### Scenario: DataSourceRepository insert runs in user context
- **WHEN** `DataSourceRepository.insert(source, user)` is called
- **THEN** the INSERT executes inside `withUserContext(user.id.value)` so RLS is active

#### Scenario: DataTypeRepository insert runs in user context
- **WHEN** `DataTypeRepository.insert(dt, user)` is called
- **THEN** the INSERT executes inside `withUserContext(user.id.value)` so RLS is active

#### Scenario: PipelineStepRepository insert runs in user context
- **WHEN** `PipelineStepRepository.insert(pipelineId, kind, config, user)` is called
- **THEN** the INSERT executes inside `withUserContext(user.id.value)` so RLS is active

### Requirement: Existing owner_id indexes cover the new RLS policy predicates
The `owner_id` indexes introduced in HEL-265 (V17) SHALL be sufficient for the RLS policy
predicates on direct-owner tables, avoiding sequential scans on hot read paths.

#### Scenario: EXPLAIN on pipelines owner filter uses index
- **WHEN** an EXPLAIN ANALYZE is run on `SELECT * FROM pipelines WHERE owner_id = ?`
- **THEN** the query plan uses `idx_pipelines_owner_id` (Index Scan or Bitmap Index Scan)

