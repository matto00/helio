## Why

Several background and system paths in Helio (ResourceTypeRegistry resolvers,
SparkJobSubmitter, DemoData seeding, SourceSchemaHealthCheck, PipelineRunService
upserts) must read across ownership boundaries without a user context. With RLS
enabled on Postgres tables these paths break unless they hold a bypass credential.
HEL-273 landed the session-variable wrapper (`DbContext.withSystemContext`) but
deferred the question of what `'system'` sentinel means at the DB level — this
ticket answers it and wires the mechanism up.

## What Changes

- **New Flyway migration** creates a `helio_privileged` Postgres role with
  `BYPASSRLS` and `NOLOGIN`; grants it to the application DB user so the
  existing single login credential gains the privilege via `SET LOCAL ROLE`.
- **`DbContext`** gains a second `JdbcBackend.Database` reference (`privilegedDb`)
  backed by a second HikariCP pool configured to use `helio_privileged` as its
  startup role. `withSystemContext` is re-implemented to run against this pool
  instead of against the app pool with only a session variable.
- **`Database.init`** is split into `initApp` / `initPrivileged` factory methods
  so each pool is configured independently. `Main` wires both pools into `DbContext`.
- **Regression test** (`DbContextSpec`) is extended: a new case proves that a
  `withUserContext` block cannot read data the simulated RLS policy would hide,
  while `withSystemContext` can — confirming physical pool separation works.
- **Inline comments** are added at every `withSystemContext` callsite explaining
  why ACL bypass is correct for that caller.

## Capabilities

### New Capabilities

- `rls-privileged-bypass`: Postgres-level BYPASSRLS mechanism via a dedicated
  `helio_privileged` role and a second HikariCP pool wired into `DbContext`.
  Defines the contract all future RLS policies depend on for the system path.

### Modified Capabilities

- `backend-persistence`: `DbContext` gains a second pool; `Database.init` is
  refactored into two factory methods. Internal contract of `withSystemContext`
  changes from "set session var only" to "run against privileged pool".
- `hikaricp-pool-config`: a second pool (`helio_privileged`) is added alongside
  the existing app pool. Pool sizing and connection limits apply to both.

## Impact

- `backend/src/main/scala/com/helio/infrastructure/Database.scala` — refactored
- `backend/src/main/scala/com/helio/infrastructure/DbContext.scala` — second pool
- `backend/src/main/scala/com/helio/app/Main.scala` — two pool init calls
- `backend/src/main/resources/db/migration/V34__rls_privileged_role.sql` — new
- `backend/src/main/resources/application.conf` — `helio.db.privileged` stanza
- `backend/src/test/scala/com/helio/infrastructure/DbContextSpec.scala` — new tests
- All `*Internal` callsite Scaladoc comments across repositories and services

## Non-goals

- Enabling any RLS policy on actual tables (HEL-275, HEL-276)
- Changing AuthService or any auth path
- Adding a second Flyway schema-history table (privileged pool re-uses the same
  migration history; role creation is idempotent via `CREATE ROLE IF NOT EXISTS`)
