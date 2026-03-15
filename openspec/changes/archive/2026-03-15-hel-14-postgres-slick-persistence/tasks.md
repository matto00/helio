## 1. Dependencies

- [x] 1.1 Add `slick`, `slick-hikaricp`, `postgresql` JDBC driver, `flyway-core` to `build.sbt`
- [x] 1.2 Add `embedded-postgres` (`io.zonky.test:embedded-postgres`) as a Test dependency

## 2. Schema and Configuration

- [x] 2.1 Create `backend/src/main/resources/db/migration/V1__init.sql` with `dashboards` and `panels` tables
- [x] 2.2 Create `backend/src/main/resources/application.conf` with DB connection config (reads `DATABASE_URL` env var)
- [x] 2.3 Add `DATABASE_URL` to `backend/.env` pointing at a local `helio` database

## 3. Infrastructure Layer

- [x] 3.1 Create `Database.scala` in `com.helio.infrastructure` — Slick `Database` instance, Flyway migration runner, `init()` method
- [x] 3.2 Create `DashboardRepository.scala` — Slick table definition + async methods: `findAll`, `findById`, `insert`, `update`
- [x] 3.3 Create `PanelRepository.scala` — Slick table definition + async methods: `findByDashboardId`, `findById`, `insert`, `updateAppearance`

## 4. Wire Up and Remove Actors

- [x] 4.1 Update `Main.scala` to initialise `Database`, run migrations, instantiate repositories, pass them to `ApiRoutes`
- [x] 4.2 Update `ApiRoutes.scala` to accept `DashboardRepository` and `PanelRepository` instead of actor refs; replace all actor asks with repository calls
- [x] 4.3 Update `DemoData.scala` — add `seedIfEmpty(dashboardRepo, panelRepo)` method that checks count before inserting
- [x] 4.4 Delete `DashboardRegistryActor.scala`
- [x] 4.5 Delete `PanelRegistryActor.scala`

## 5. Tests

- [x] 5.1 Update `ApiRoutesSpec.scala` — replace actor-based route builder with embedded-postgres setup (`beforeAll`/`afterAll`), run Flyway migrations, instantiate repositories
- [x] 5.2 Verify all existing route behaviour tests still pass against the real DB
- [x] 5.3 Add test asserting data survives a repository reload (insert, re-query, verify)

## 6. Verification

- [x] 6.1 Run `sbt test` — all tests pass against embedded-postgres
- [x] 6.2 Start a local Postgres instance, set `DATABASE_URL`, run `sbt run` — verify demo data loads and survives restart
- [x] 6.3 Confirm frontend flows work end-to-end with the running backend (create dashboard, create panel, refresh page — data persists)
