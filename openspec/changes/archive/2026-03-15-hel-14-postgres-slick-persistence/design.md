## Context

The two registry actors were introduced as temporary in-memory state holders. With a real DB, they serve no purpose — the DB is the source of truth and handles concurrent write safety via transactions. Removing them simplifies the architecture: `ApiRoutes` → `Repository` → Postgres, one fewer message-passing layer.

Current Slick version (3.5.x) supports Postgres via `slick-hikaricp` + `postgresql` JDBC driver. Layout and appearance are complex nested structures that are always read and written as units — never queried field-by-field — making JSON text columns the right storage choice. This also means the existing Spray JSON formatters are reused directly.

## Goals / Non-Goals

**Goals:**
- Dashboard and panel data persists across backend restarts
- Schema managed via Flyway (versioned SQL migrations)
- Repository layer isolates all DB access behind a clean async interface
- Sort order (`lastUpdated desc`) enforced in SQL, not application code
- Tests run against a real Postgres instance (embedded) for full fidelity
- Demo data seeds on first run only

**Non-Goals:**
- Multi-user authentication or tenancy
- User-uploaded dataset storage (future ticket)
- Connection pool tuning beyond sensible defaults
- Database-level soft deletes or audit logging

## Decisions

**Remove registry actors entirely** — actors were a temporary workaround for no DB. With Postgres, concurrent write safety comes from transactions. Keeping actors as thin pass-throughs would add indirection with no benefit. `ApiRoutes` calls repositories via `Future` directly.

**Package: `com.helio.infrastructure`** — repository classes live in a new `infrastructure` package, keeping domain and API packages clean. `Database.scala` in the same package initialises Slick and runs Flyway migrations on startup.

**Slick over raw JDBC** — type-safe table definitions, composable queries, Future-based async that integrates cleanly with Akka's execution context. Column mappers handle `Instant` ↔ `TIMESTAMP WITH TIME ZONE` and JSON text ↔ domain types via Spray JSON.

**Layout and appearance as TEXT/JSON columns** — layout changes with every panel drag; appearance is always overwritten in full. Neither is ever queried column-by-column. A single JSON blob per column is correct and keeps the schema stable as these structures evolve.

**Flyway for migrations** — runs automatically on `Database.init()` at startup. Single `V1__init.sql` for now. This establishes the migration discipline before the schema grows.

**embedded-postgres for tests** — `io.zonky.test:embedded-postgres` bundles real Postgres binaries, no Docker required. Each test suite starts a fresh embedded instance. `ApiRoutesSpec` gets a `beforeAll`/`afterAll` lifecycle that starts/stops the embedded DB and runs migrations.

**DemoData conditional seeding** — on startup, if `SELECT COUNT(*) FROM dashboards = 0`, seed demo data. This means a clean DB always gets the demo dashboards, but user data is never overwritten on restart.

**Connection config via `.env`** — `DATABASE_URL` environment variable (e.g. `jdbc:postgresql://localhost:5432/helio`). Falls back to sensible defaults for local dev. Tests use the embedded-postgres JDBC URL.

## Risks / Trade-offs

- [Spray JSON ↔ Slick column mapper coupling] → If JSON formatters change, stored blobs may become unreadable. Mitigated by treating formatters as stable contracts (they're already API-facing).
- [Slick execution context] → Slick's DB I/O runs on its own thread pool. Care is needed not to block Akka dispatchers. Mitigated by ensuring all DB calls stay in `Future`-returning repository methods, never blocking inside actor message handlers (which no longer exist).
- [embedded-postgres binary download] → First test run downloads a Postgres binary (~50MB). Cached after first download. CI will need internet access on first run.
- [Schema evolution] → Layout/appearance as blobs means Flyway can't inspect field-level changes. If the domain model for these types changes, a migration must transform the JSON. Acceptable trade-off for current schema stability.
