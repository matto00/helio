## Context

All repositories (`DashboardRepository`, `PanelRepository`, `DataTypeRepository`, `DataSourceRepository`,
`PipelineRepository`, etc.) currently call `db.run(action)` directly. When RLS policies are enabled in a later
sub-ticket they will reference `current_setting('app.current_user_id')` — a session variable that must be set
on every connection before a policy-guarded query executes.

HikariCP pools connections: a `SET` (non-LOCAL) would persist after COMMIT and contaminate the next request from
the pool. `SET LOCAL` scopes the assignment to the current transaction, so it is automatically cleared at
COMMIT or ROLLBACK. This is the foundational safety property that makes the wrapper safe.

AuthService is off-limits. User identity flows in from `AuthenticatedUser` already present at route/service
boundaries; the wrapper simply receives the user ID as a `String`.

## Goals / Non-Goals

**Goals:**
- `DbContext` class in `com.helio.infrastructure` providing `withUserContext(userId)(action)` and
  `withSystemContext(action)` DBIO wrappers
- All ACL'd repository reads/writes route through one of those two wrappers
- `DbContextSpec` regression test proving the session var does NOT leak across pooled connections
- CONTRIBUTING.md section documenting the contract
- No RLS policy is enabled; all existing tests pass unmodified

**Non-Goals:**
- Enabling Postgres RLS policies (HEL-274+)
- Privileged role / BYPASSRLS design (separate sub-ticket)
- AuthService modifications
- Frontend or API changes

## Decisions

### D1: `withUserContext` signature — `(String)(DBIO[R]) => Future[R]`

Takes a plain `String` (the `UserId.value`) rather than `AuthenticatedUser` to minimise coupling and make
the system-context variant symmetric. The wrapper prepends `SET LOCAL app.current_user_id = '<id>'` as
the first statement inside `.transactionally`, then appends the caller's action.

Alternative considered: `SlickDBIO[R] => DBIO[R]` returning a DBIO (not Future) so callers compose
further. Rejected: all callsites are the `db.run` boundary; returning Future keeps the existing call shape.

### D2: `withSystemContext` sets the var to the sentinel value `'system'`

RLS policies (in later sub-tickets) will be written to treat `'system'` as a bypass sentinel. Using
`SET LOCAL` keeps the isolation guarantee identical to user context. The `system` literal is a constant in
`DbContext` — a later privileged-role sub-ticket can switch to `SET LOCAL ROLE` instead.

### D3: `DbContext` receives `JdbcBackend.Database` — no new trait/abstraction

Repositories already hold `db: JdbcBackend.Database` directly. `DbContext` wraps the same instance.
This keeps the structural change minimal and testable with EmbeddedPostgres (same pattern as
`DataTypeRepositorySpec`).

### D4: Repository call sites — minimal mechanical change

Each `db.run(action)` in an ACL'd repository is replaced with `ctx.run(action, userId)` where
`ctx: DbContext` is a constructor parameter. Non-ACL'd repos (`UserRepository`, `UserSessionRepository`,
`UserPreferenceRepository`) and internal privileged reads use `ctx.runSystem(action)`.

`DemoData` and `SourceSchemaHealthCheck` use `ctx.runSystem` because they are infrastructure-level
callers with no user context.

### D5: Connection-leak regression test uses EmbeddedPostgres

The test directly verifies the leak scenario: set user context in one transaction, commit, then run a
raw `SELECT current_setting('app.current_user_id', true)` on a fresh `db.run` without a wrapper.
The result must be `null` / empty — not the previously-set value.

## Risks / Trade-offs

- [Risk] A future developer adds `db.run(rawAction)` in a repository, bypassing the wrapper.
  → Mitigation: CONTRIBUTING.md documents the rule; evaluator gate checks for raw `db.run` in repository files.

- [Risk] `SET LOCAL` requires the code to always run inside an explicit transaction — Slick's
  auto-commit mode would execute it as a single-statement transaction that commits immediately, making
  `SET LOCAL` a no-op on subsequent statements.
  → Mitigation: wrapper always appends `.transactionally`, which forces Slick to open an explicit
    transaction boundary. This is tested in `DbContextSpec`.

- [Risk] Repositories that currently call `db.run(action.transactionally)` themselves would be
  double-wrapped.
  → Mitigation: in `withUserContext`, the outer `DBIO.seq(setLocal, action).transactionally` is
    correct even if `action` itself calls `.transactionally` — Postgres ignores nested BEGIN/COMMIT
    (savepoints are not used) and `SET LOCAL` is still scoped to the outermost transaction.

## Migration Plan

1. Add `DbContext.scala` to `com.helio.infrastructure`
2. Add constructor param `ctx: DbContext` to each ACL'd repository; update `Main.scala` wiring
3. Replace `db.run(action)` with `ctx.withUserContext(userId)(action)` / `ctx.withSystemContext(action)`
4. Add `DbContextSpec` with embedded Postgres
5. Update `CONTRIBUTING.md`
6. Run `sbt test` — all existing tests pass
