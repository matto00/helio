## Why

Dashboard and panel data is currently lost on every backend restart because both registry actors hold state in memory. This blocks any meaningful use of the application and prevents multi-session workflows. Introducing PostgreSQL-backed persistence makes data durable and establishes the storage foundation for future user data features.

## What Changes

- Add PostgreSQL + Slick + HikariCP + Flyway to the backend
- Replace in-memory registry actors (`DashboardRegistryActor`, `PanelRegistryActor`) with repository classes (`DashboardRepository`, `PanelRepository`) backed by Postgres
- `ApiRoutes` talks directly to repositories via `Future` — actors removed from the data path
- `V1__init.sql` Flyway migration creates `dashboards` and `panels` tables; layout and appearance stored as JSON text columns
- `DemoData` seeding becomes conditional: only runs when tables are empty on startup
- Test suite replaced with embedded-postgres (`io.zonky.test:embedded-postgres`) for real Postgres semantics without Docker

## Capabilities

### New Capabilities

- `backend-persistence`: Dashboard and panel data persisted in PostgreSQL; survives restarts; Flyway manages schema

### Modified Capabilities

- `dashboard-ordering`: Sort responsibility moves from actor to SQL `ORDER BY last_updated DESC`
- `panel-ordering`: Same — `ORDER BY last_updated DESC` in repository query

## Impact

- `backend/build.sbt` — new dependencies: `slick`, `slick-hikaricp`, `postgresql`, `flyway-core`, `embedded-postgres` (test)
- `backend/src/main/resources/db/migration/V1__init.sql` — new Flyway migration
- `backend/src/main/scala/com/helio/app/DashboardRegistryActor.scala` — **removed**
- `backend/src/main/scala/com/helio/app/PanelRegistryActor.scala` — **removed**
- `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala` — new
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — new
- `backend/src/main/scala/com/helio/infrastructure/Database.scala` — new (Slick DB + Flyway init)
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — updated to use repositories
- `backend/src/main/scala/com/helio/app/Main.scala` — updated to wire DB
- `backend/src/main/scala/com/helio/app/DemoData.scala` — updated to be conditional
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — updated to use embedded-postgres
- `backend/src/main/resources/application.conf` — DB connection config
- `.env` — `DATABASE_URL` for local development
