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

## Cycle 1b — Updated root cause and fix design

Cycle 1 could not reproduce the ticket's literal "schema disappears on
restart" recipe and proposed three defensive fixes (A/B/C). The user then
surfaced that they had seen the same symptom **without any restart**,
matching the HEL-242 pattern of an incomplete bug recipe.

Cycle 1b ran a 12-trigger matrix against a fresh CSV upload and **did
reproduce** the symptom deterministically:

> Trigger 12 — `DELETE /api/types/:id` on a source's auto-inferred DT:
> source row remains, DT row is gone, `relatedType` lookup in
> `SourceDetailPanel` returns `undefined`, schema section renders nothing.

This trigger requires no restart. The Type Registry sidebar
(`shared/chrome/SidebarBody.tsx` lines 119-124) exposes Delete on every
DT the user owns, with no visual or service-layer guard against deleting
the auto-inferred schema of a still-existing source.

**Updated fix design (cycle 2)** — see `executor-report-1.md` §1b.6 for
full surface estimate. Summary:

- **Fix B′ (PRIMARY)**: `DataTypeService.delete` rejects 409 when DT's
  `sourceId` points to a still-existing source row.
- **Fix D (NEW)**: `refreshCsv` and `applyStaticRefresh` re-create the
  DT when missing (upsert semantics). Required to make Fix C′'s
  recovery affordance actually fix orphan state.
- **Fix A (RETAINED)**: Boot-time health check that logs orphaned
  source rows. Defense-in-depth; surfaces pre-existing drift.
- **Fix C′ (EXPANDED from C)**: `SourceDetailPanel` renders "Schema
  unavailable — [Refresh source]" when `relatedType` is undefined for a
  CSV / Static source. Wires the button to `refreshSource(...)` which
  (via Fix D) re-creates the DT. Fallback: if refresh fails because the
  CSV file is missing, the affordance offers Delete + re-upload.

Total estimated surface: ~100 LoC across 4-5 files + tests.

## Architectural confirmation — additional cycle-1b observations

- **No frontend cache outside Redux thunks.** `dataTypes.items` is only
  mutated by `fetchDataTypes` / `updateDataType` / `deleteDataType` —
  no listener middleware or service worker. The disappearance is a true
  reflection of DB state via `GET /api/types`.
- **No backend cache between routes and DB.** Session lookup uses
  fresh Slick reads per request; no in-memory user/session cache.
  Slick / HikariCP have no statement cache that would invisibly serve
  stale rows.
- **`LocalFileSystem.fromEnv()` resolves uploads root relative to JVM
  cwd at startup.** Per-worktree backend restarts see different upload
  roots, which breaks `previewCsv` / `refreshCsv` (file 404) but does
  NOT affect schema display (DB-backed). Worth a spinoff ticket but
  out of scope here.

## Spinoffs (not for HEL-256)

1. **`GET /api/types/:id` uses unscoped `dataTypeRepo.findById`** —
   leaks cross-user DT info to any holder of a valid bearer token.
   Security / Medium.
2. **`LocalFileSystem.fromEnv` cwd-relative resolution** — sharp edge
   for local-dev across worktrees. DevEx / Low.
3. **Type Registry sidebar lacks visual distinction** between source-DTs
   and pipeline-output DTs. Adds friction even after Fix B′ ships
   ("why can't I delete this?"). UX / Low.
