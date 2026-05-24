## ADDED Requirements

### Requirement: Database initialisation supports separate app and privileged pools
The `Database` object SHALL expose `initApp` and `initPrivileged` factory methods.
`initApp` runs Flyway migrations and returns a `JdbcBackend.Database` configured
for the standard application role. `initPrivileged` returns a second
`JdbcBackend.Database` whose `connectionInitSql` configures connections to use
`helio_privileged` as the active role. Both methods accept the same Typesafe Config
object; `initPrivileged` reads from the `helio.db.privileged` sub-config.

#### Scenario: initApp creates schema on first start
- **WHEN** `Database.initApp` is called against a database with no schema
- **THEN** Flyway applies all pending migrations before returning the database handle

#### Scenario: initPrivileged does not re-run migrations
- **WHEN** `Database.initPrivileged` is called after `initApp` has already migrated
- **THEN** the privileged pool is created without re-running any migrations
