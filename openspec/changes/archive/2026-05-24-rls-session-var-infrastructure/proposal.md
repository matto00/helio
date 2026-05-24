## Why

Postgres Row-Level Security requires `current_setting('app.current_user_id')` to be set in the session before any policy-guarded query runs. HikariCP pools connections, so a naively-set session variable would leak from one request to another — a P0 data-isolation failure. This change builds the foundational `withUserContext` / `withSystemContext` wrapper that scopes the variable to the transaction via `SET LOCAL`, guaranteeing it is cleared automatically at COMMIT or ROLLBACK before the connection returns to the pool.

## What Changes

- **New file** `backend/src/main/scala/com/helio/infrastructure/DbContext.scala`: provides `withUserContext(userId)(action)` and `withSystemContext(action)` DBIO helpers that prepend `SET LOCAL app.current_user_id` and run `.transactionally`
- **Repository migration**: every repository read/write in `DashboardRepository`, `PanelRepository`, `DataTypeRepository`, `DataSourceRepository`, `PipelineRepository` (and any other ACL'd repository) is wrapped via `withUserContext`/`withSystemContext` — no raw `db.run(action)` remains on ACL'd tables
- **Test**: `DbContextSpec` — connection-leak regression test confirming the session var is not visible on a subsequent `db.run` after the wrapping transaction commits
- **Docs**: `CONTRIBUTING.md` gains a "Database transactions & RLS context" section describing the wrapper contract

## Capabilities

### New Capabilities

- `db-context-wrapper`: Transaction-scoped session variable infrastructure (`withUserContext` / `withSystemContext`) for Postgres RLS; no RLS policies are enabled by this change

### Modified Capabilities

- `backend-persistence`: Repository layer now routes all ACL'd reads/writes through `withUserContext`/`withSystemContext` rather than bare `db.run`

## Impact

- Backend only — no API surface change, no frontend change, no schema migration
- `DatabaseComponent` (or equivalent Slick `Database` holder) is passed to `DbContext`; all repositories gain a dependency on `DbContext`
- AuthService is untouched — user identity is already extracted upstream and passed as a parameter
- No new external dependencies; `SET LOCAL` is standard Postgres SQL available since PG 7.4

## Non-goals

- Enabling any RLS policy (later sub-tickets HEL-274/275/276/277)
- Privileged role / `BYPASSRLS` design (separate ticket, parallelizable)
- Frontend or API contract changes
