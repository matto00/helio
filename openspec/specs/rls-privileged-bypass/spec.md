# rls-privileged-bypass Specification

## Purpose
TBD - created by archiving change rls-privileged-bypass. Update Purpose after archive.
## Requirements
### Requirement: Privileged Postgres role exists with BYPASSRLS
The database schema SHALL include a `helio_privileged` role with the `BYPASSRLS`
and `NOLOGIN` attributes, created idempotently by a Flyway migration. The
application login role SHALL be granted `helio_privileged` so it can assume the
role via `SET LOCAL ROLE helio_privileged`.

#### Scenario: Role exists after first migration run
- **WHEN** the backend starts against a fresh database and Flyway applies V34
- **THEN** a Postgres role named `helio_privileged` exists with `BYPASSRLS`
  and `NOLOGIN` attributes

#### Scenario: Migration is idempotent on repeat runs
- **WHEN** Flyway has already applied V34 and the backend restarts
- **THEN** Flyway skips V34 without error and `helio_privileged` remains intact

### Requirement: DbContext maintains separate app and privileged pools
`DbContext` SHALL hold two HikariCP connection pools: an app pool for
`withUserContext` calls and a privileged pool whose connections have
`helio_privileged` as their active role, used exclusively by `withSystemContext`.

#### Scenario: withUserContext routes to the app pool
- **WHEN** `withUserContext(userId)(action)` is called
- **THEN** the action executes on a connection from the app pool with
  `app.current_user_id` set to `userId` and no BYPASSRLS privilege

#### Scenario: withSystemContext routes to the privileged pool
- **WHEN** `withSystemContext(action)` is called
- **THEN** the action executes on a connection from the privileged pool whose
  active role is `helio_privileged`, granting BYPASSRLS for that transaction

### Requirement: Normal user-context requests cannot gain RLS bypass
A request processed through `withUserContext` SHALL NOT be able to trigger or
inherit the BYPASSRLS privilege, regardless of session variable state.

#### Scenario: User-context connection has no BYPASSRLS
- **WHEN** a query runs inside `withUserContext` on a table with RLS enabled
- **THEN** RLS policies are evaluated normally; rows not matching the policy are
  excluded and no BYPASSRLS privilege is available to that connection

#### Scenario: Privileged pool connection bypasses RLS
- **WHEN** a query runs inside `withSystemContext` on a table with RLS enabled
- **THEN** all rows are visible regardless of RLS policies because the
  `helio_privileged` role carries BYPASSRLS

### Requirement: Every withSystemContext callsite carries a bypass justification comment
Each call to `withSystemContext` in repository or service code SHALL have an inline
Scaladoc or block comment explaining why ACL bypass is correct for that specific
caller.

#### Scenario: ResourceTypeRegistry resolver is justified
- **WHEN** the `ResourceTypeRegistry` resolver calls `findByIdInternal`
- **THEN** the callsite has a comment stating it resolves ownership FOR the ACL
  check (chicken-and-egg) and therefore BYPASSRLS is required

#### Scenario: Background and pipeline callers are justified
- **WHEN** `SparkJobSubmitter`, `PipelineRunRepository` internal methods,
  `DataTypeRowRepository`, `SourceSchemaHealthCheck`, or `DemoData` call
  `withSystemContext`
- **THEN** each callsite has a comment stating the pipeline/boot ACL gate that
  makes bypass safe for that caller

