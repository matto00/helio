# Tasks — HEL-256 cycle 1

## Cycle 1 (investigation-only, this commit)

- [x] Read ticket.md and confirm pre-investigated surface
- [x] Trace the Sources-page schema display path (UI → API → repository)
- [x] Inspect Flyway migrations for FK cascade behavior on
      `data_types.source_id`
- [x] Inspect dev DB for orphaned DT rows (NULL `source_id` with matching
      live source) and characterize each one
- [x] Reproduce empirically:
  - [x] Fresh CSV upload as `matt@helio.dev` (port 8320)
  - [x] CSV upload with field overrides
  - [x] Static source creation
  - [x] SQL source creation
  - [x] Single backend restart
  - [x] Second consecutive backend restart
  - [x] Verify all four sources retain their inferred schema across both
        restarts
- [x] Test mutation paths: `PATCH /api/types/:id`, `POST
      /api/data-sources/:id/refresh` — confirm `source_id` is preserved
- [x] Identify which of the six pre-recorded candidates (ticket.md) is
      correct (or surface a seventh)
- [x] Write `executor-report-1.md` with reproduction recipe, root-cause
      finding, fix design, regression test plan, risks
- [x] Write `files-modified.md` for evaluator orientation
- [x] Commit only `openspec/changes/datasource-schema-restart-fix/*`
      (zero production code in cycle 1)

## Cycle 1b (investigation-only, continued — this commit)

- [x] Re-read ticket.md + executor-report-1 + design.md
- [x] Map frontend display path (SourcesPage, SourceDetailPanel,
      DataSourceList, sourcesSlice, dataTypesSlice) and confirm no
      cache layer outside fetchDataTypes
- [x] Verify backend session + Slick layers have no in-memory cache
      that could go stale mid-session
- [x] Identify FileSystem worktree-cwd issue (affects preview/refresh
      only; not schema display)
- [x] Reproduce empirically — 12 triggers tried against a fresh
      `matt@helio.dev` CSV upload on the cycle-1b backend (port 8320):
  - [x] T1 PATCH source name → DT preserved
  - [x] T2 POST refresh → DT preserved (when file exists)
  - [x] T3 GET preview → DT preserved (read-only)
  - [x] T4 GET DT directly → DT preserved
  - [x] T5 GET sources list → DT preserved
  - [x] T6 PATCH DT name → DT preserved (sourceId intact)
  - [x] T7 PATCH DT fields → DT preserved (sourceId intact)
  - [x] T8 create pipeline targeting source → DT preserved
  - [x] T9 run pipeline → source DT preserved; output DT mutated as
        expected
  - [x] T10 re-upload SAME-name source → both DTs coexist
  - [x] T11 DELETE source → DT orphaned (`sourceId → null`)
  - [x] **T12 DELETE DT via Type Registry sidebar → REPRODUCED:
        source remains, schema disappears from Sources page**
- [x] Confirm root cause: `DataTypeService.delete` only checks panel
      binding, not source linkage. Type Registry sidebar exposes
      delete on every DT, including source-auto-inferred ones.
- [x] Verdict on cycle-1 Fix A/B/C: B promoted to primary (B′);
      A retained as defense-in-depth; C expanded to C′ (recovery
      affordance); new Fix D added (refresh recreates missing DT)
- [x] Write cycle-1b appendix to executor-report-1.md
- [x] Update tasks.md (this section) + design.md
- [x] Cleanup dev-DB test artifacts (HEL256ReproTest source + DT,
      HEL256TestPipeline, orphan output DTs all deleted)
- [x] Commit only `openspec/changes/datasource-schema-restart-fix/*`
      (zero production code in cycle 1b)

## Cycle 2 (revised after cycle-1b — out of scope for this commit)

- [ ] **Fix B′** (PRIMARY): `DataTypeService.delete` rejects 409 when
      DT's `sourceId` points to a still-existing source (thread
      `dataSourceRepo` in via constructor)
- [ ] **Fix D**: `refreshCsv` and `applyStaticRefresh` re-create the
      DT row if missing (upsert semantics, preserves `sourceId`)
- [ ] **Fix A**: `SourceSchemaHealthCheck` boot-time warn for orphaned
      sources (defense-in-depth)
- [ ] **Fix C′**: `SourceDetailPanel` empty-schema affordance with
      "Refresh source" recovery; "Delete + re-upload" fallback when
      refresh fails (file missing)
- [ ] Tests:
  - [ ] `DataTypeServiceSpec` — delete-of-source-DT returns 409
  - [ ] `DataSourceServiceSpec` — refresh re-creates missing DT
  - [ ] `SourceSchemaHealthCheckSpec` — orphan detection
  - [ ] `SourceDetailPanel.test.tsx` — empty-schema affordance +
        refresh recovery
- [ ] Gates: `npm test`, `npm run lint`, `npm run format:check`,
      `npm run check:schemas`, `npm run check:openspec`,
      `npm run check:scala-quality`, `cd backend && sbt test`
- [ ] Playwright (optional, recommended): upload → delete-DT-from-
      registry → expect 409 toast → schema still on Sources page

## Spinoffs (separate tickets — not for HEL-256)

- [ ] `GET /api/types/:id` uses unscoped repo `findById` — leaks
      cross-user DT info (Security / Medium)
- [ ] `LocalFileSystem.fromEnv` resolves relative to JVM cwd, causing
      file-not-found on per-worktree backend runs (DevEx / Low)
- [ ] Type Registry sidebar: no visual distinction between
      source-auto-inferred DTs vs pipeline-output DTs (UX / Low)
