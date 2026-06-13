## 1. Backend — Repair Script

- [x] 1.1 Create `backend/scripts/` directory
- [x] 1.2 Write `backend/scripts/repair-dev-db.sql` — guarded DO block to UPDATE all six NULL-owner DataType rows (ids: `fff8488f`, `a38abc47`, `ac245193`, `e262207b`, `89f51535`, `9978e754`) to `owner_id = '9532cfcf-9882-45ba-8247-23706bc00113'` (matt@helio.dev); no-op if already set
- [x] 1.3 Add guarded UPDATE for ProfitAgg output DataType (`c1005183-0cbe-4631-ac62-95421e18f0a5`) — set `owner_id = '9532cfcf-9882-45ba-8247-23706bc00113'`; no-op if already correct
- [x] 1.4 Add guarded UPDATE to fix the ProfitAgg join step config — set `pipeline_steps.config = '{"rightDataSourceId":"339018f2-3760-415d-baeb-35d2e3061992","joinKey":"month","joinType":"inner"}'` where `id = '9607c209-421c-48b9-b4f2-1cb72b103092'`; verify that "month" is a valid shared key between the HelioProfit CSV and Profit static DataSource schemas before committing this value
- [x] 1.5 Add guarded UPDATE to set ProfitAgg pipeline `owner_id = '9532cfcf-9882-45ba-8247-23706bc00113'` where `id = '6c75e682-4a7c-469b-b9ba-5fda8e4adc42'`; no-op if already correct
- [x] 1.6 Verify the complete script is idempotent — running it twice leaves the DB in the same correct state

## 2. Backend — Documentation

- [x] 2.1 Add "Dev DB repair" section to `backend/README.md` — describe the four drift symptoms (pipeline 422, binding scrub, NULL-owner types, wrong-owner pipeline), the psql command to run the script, how to verify success, and a note that demo dashboards/panels are seeded as SystemUser-owned and any future DataType/DataSource additions to DemoData must use a real user UUID

## 3. Tests

- [x] 3.1 Apply the repair script against the local dev DB: `psql postgresql://matt@localhost:5432/helio -f backend/scripts/repair-dev-db.sql`
- [x] 3.2 Start the backend and verify AC1: `POST /api/pipelines/6c75e682-4a7c-469b-b9ba-5fda8e4adc42/run` as matt@helio.dev returns non-422
- [x] 3.3 Verify AC2: bind a panel to DataType `c1005183-0cbe-4631-ac62-95421e18f0a5` via PATCH and confirm the binding persists across a subsequent GET (not scrubbed)
- [x] 3.4 Verify AC3: `SELECT COUNT(*) FROM data_types WHERE owner_id IS NULL` returns 0
- [x] 3.5 Run backend ScalaTest suite (`sbt test` in `backend/`) to confirm no regressions
