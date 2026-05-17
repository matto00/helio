# Design — HEL-256 cycle 1

## Investigation strategy

Phase order — pre-investigated surface (ticket.md) covers the static-analysis
slice. Cycle 1 work focuses on empirical reproduction and dev-DB forensics
because the recorded hypothesis(es) from the Linear ticket are
unverified — and the lesson from HEL-242 is that the recorded hypothesis is
usually wrong.

1. Map the Sources-page schema display path end-to-end (UI → API → repository)
2. Probe the dev DB for orphaned `data_types` rows whose `source_id` should
   point to an existing CSV but doesn't
3. Reproduce empirically:
   - Fresh CSV upload via `POST /api/data-sources` as `matt@helio.dev`
   - Verify schema visible on Sources page (verified via direct `/api/types` call)
   - Kill backend, restart, refetch
   - Repeat for: CSV with field overrides, Static, SQL
   - Repeat across multiple consecutive restarts
4. Confirm or refute each of the six pre-recorded candidates

## Architectural confirmation

The display path is:

```
SourcesPage (mount)
  ├─ dispatch(fetchSources)   → GET  /api/data-sources    → DataSourceRepository.findAll(ownerUuid)
  └─ dispatch(fetchDataTypes) → GET  /api/types           → DataTypeRepository.findAll(ownerUuid)

SourceDetailPanel (render)
  └─ useAppSelector: state.dataTypes.items.find(dt => dt.sourceId === source.id)
        └─ if found AND fields.length > 0 → render schema table
        └─ else → render only the Preview section (no schema-disappeared error)
```

Key observations:

- The schema lives in `data_types.fields` (Slick `String` JSON column),
  inserted at `DataSourceService.createCsv` lines 113–131 (verified)
- The frontend selector is owner-scoped indirectly: `/api/types` is filtered
  by `owner_id` in `DataTypeRepository.findAll`
- The selector is a pure `dt.sourceId === source.id` match. If the DT row's
  `source_id` ever becomes NULL, the schema silently vanishes from the UI
- The SourcesPage does **not** render a "schema failed to load" state — it
  only renders the schema section when it finds a match, so failure modes
  on the DataTypes fetch are invisible
- `data_types.source_id` has `ON DELETE SET NULL` on the FK to
  `data_sources(id)` (Flyway V4). Deleting a source orphans its DT with
  `source_id = NULL` — the row stays but the link is broken

## Restart-time invariants

- Postgres + Flyway means the DB is fully durable across restart; no
  `Database.init` truncate or wipe path
- `DemoData.seedIfEmpty` only seeds dashboards + panels, only when
  `dashboard.count == 0` — does NOT touch `data_sources` or `data_types`
- No in-memory cache of schemas exists; every `/api/types` call reads
  from Postgres
- Sessions are durable (DB-backed `user_sessions` table), so
  `AuthenticatedUser.id` is stable across restart for a given Bearer token
- `LocalFileSystem.fromEnv()` resolves the uploads root via
  `Paths.get(...).toAbsolutePath` — uses process cwd. If `sbt run` is
  invoked from a different cwd between sessions, `previewCsv` would 404,
  but the schema display path does NOT depend on the file (only on the
  DataType row)

## Reproduction matrix and findings — see executor-report-1.md

## Fix design (cycle 2)

See `executor-report-1.md` § "Fix design" for surface estimate and approach
keyed to the root-cause finding. Both the design and the regression-test
plan live in the report rather than this design doc, because they are
predicated on the cycle-1 finding and would otherwise have to be revised
when the orchestrator-relay reviews the report.
