## Context

`DbContext` (landed in HEL-273) scopes `app.current_user_id` per transaction via
`SET LOCAL` (= `set_config(..., true)`). `withSystemContext` currently writes the
`'system'` sentinel into that variable. RLS policies on user-owned tables will be
added in HEL-275 and HEL-276; those policies need a mechanism to let the system
path bypass them without allowing normal user-context requests to do the same.

Two options were evaluated:

**Option B** — session flag (`SET LOCAL app.is_system = true`) in every RLS policy.
Every policy needs an `OR current_setting('app.is_system', true) = 'true'` clause.
A developer who forgets the clause on a new table silently closes the system path.
A `withUserContext` call where `SET LOCAL app.is_system` is accidentally set (e.g.
from a previous call on a pooled connection — though SET LOCAL should prevent this)
would grant bypass. The coupling is implicit and the blast radius of any mistake is
high.

**Option A** — dedicated `helio_privileged` Postgres role with `BYPASSRLS`. The DB
engine itself honours `BYPASSRLS`; no per-policy clause is required. Privileged
connections use a physically distinct pool that the application user (`helio_app`)
cannot impersonate at the SQL level. A missed `SET LOCAL ROLE` in application code
simply falls through to the app pool (no bypass granted). Auditing is straightforward:
any connection in the privileged pool is system-context by construction.

**Decision: Option A.**

## Goals / Non-Goals

**Goals:**
- Create `helio_privileged` Postgres role with `BYPASSRLS NOLOGIN` via Flyway
- `helio_app` (the login role) is granted `helio_privileged` so it can `SET LOCAL ROLE`
- `DbContext` holds two pools: `db` (app) and `privilegedDb` (privileged)
- `withSystemContext` runs against `privilegedDb`; `withUserContext` runs against `db`
- A normal `withUserContext` call is provably incapable of gaining RLS bypass (different pool, no BYPASSRLS)
- Regression test confirms the isolation holds

**Non-Goals:**
- Enabling any RLS policy on actual tables (HEL-275, HEL-276)
- Changing the Flyway schema-history table or using a separate privileged Flyway run
- Altering AuthService, session management, or any HTTP route

## Decisions

### D1 — Role creation via Flyway migration (V34)

```sql
CREATE ROLE IF NOT EXISTS helio_privileged BYPASSRLS NOLOGIN;
```

Idempotent. The application login role (`DB_USER`) is granted `helio_privileged`
so it can `SET LOCAL ROLE helio_privileged` at pool-checkout time. Flyway runs as
the same DB_USER that created the schema; no superuser is needed — `GRANT ROLE`
requires only that the grantor is a member of the role or is superuser.

Local dev note: the embedded Postgres used in tests has a `postgres` superuser
that can create roles; the migration runs cleanly.

### D2 — Second HikariCP pool (`helio.db.privileged` stanza)

`application.conf` gains a `helio.db.privileged` sub-object that inherits base
settings (url, driver, stringtype) and overrides `connectionInitSql` to execute
`SET LOCAL ROLE helio_privileged` on every connection checkout. Pool sizing mirrors
the app pool (max 5, min idle 0) — system-context operations are infrequent and
short-lived.

`Database.init` is split into `initApp` / `initPrivileged`. Both factory methods
run Flyway (Flyway is idempotent; the second call is a no-op because the schema
history table marks all migrations done). `Main` calls both and passes the two
`JdbcBackend.Database` handles to a refactored `DbContext` constructor.

### D3 — `DbContext` constructor and `withSystemContext` re-implementation

```scala
class DbContext(db: JdbcBackend.Database, privilegedDb: JdbcBackend.Database)(...)
```

`withSystemContext` runs `action.transactionally` on `privilegedDb` — no session
variable is set. `withUserContext` remains unchanged (app pool, SET LOCAL).

The `SystemUserId` sentinel constant and `setVar` helper are removed; they have no
role once the privileged pool is the bypass mechanism.

### D4 — Inline comments at every `withSystemContext` callsite

Each callsite (ResourceTypeRegistry resolvers, DashboardRepository.findById
public-grant path, DataTypeRowRepository, PipelineRunRepository `*Internal`
methods, SourceSchemaHealthCheck, DemoData seeding, SparkJobSubmitter) already has
a comment explaining the reason. These are verified to be present and accurate as
part of this ticket's implementation.

### D5 — Regression test extension in `DbContextSpec`

A new test case inserts a row owned by user A using `withUserContext(userA)`, then
reads it with `withUserContext(userB)`. Without RLS enabled the read succeeds (no
policies on the embedded test DB). With RLS enabled (enabled by a per-test `ALTER
TABLE ... ENABLE ROW LEVEL SECURITY` call inside the spec) the `withUserContext`
read returns nothing, while `withSystemContext` still returns the row. This proves
the pool separation works before any production table policy is added.

## Risks / Trade-offs

[Two pools double connection count] → Mitigation: privileged pool is sized at max 5
like the app pool; total max is 10, acceptable for Cloud Run (previously max was 5).

[Flyway runs twice] → `Flyway.migrate()` is idempotent; second call is a 2-ms
metadata check. No practical risk.

[Local dev with trust auth] → `SET LOCAL ROLE` requires the session user to have
`GRANT helio_privileged`. In embedded test Postgres (zonky) the migration creates
the role and grants it to the `postgres` superuser who implicitly has all roles.
For a fresh local DB the developer must have run the migration (standard startup).

## Migration Plan

1. Flyway migration V34 runs on next backend startup; role creation is idempotent.
2. Application config gains `helio.db.privileged` stanza; existing `helio.db`
   stanza is unchanged (no env-var changes required in production).
3. `DbContext` constructor changes from one arg to two — `Main` is the sole
   construction site, updated in the same commit.
4. Rollback: revert `Main` to single-pool `DbContext`, drop `helio.db.privileged`
   stanza. The `helio_privileged` role in Postgres is harmless if left in place.

## Open Questions

None — Option A is chosen; implementation path is fully specified.

## Planner Notes

Self-approved. No new external dependencies (HikariCP, Flyway, zonky embedded
Postgres already on classpath). No breaking API changes. No schema data migration.
Security boundary is enforced by Postgres itself (BYPASSRLS attribute on the role)
rather than by application code, which is the correct trust model.
