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

## Cycle 2 (out of scope here; will be re-scoped after evaluator review)

- [ ] Implement fix per cycle-1 design
- [ ] Add restart-persistence regression test for CSV, Static, and SQL
      (ScalaTest, hitting the real Slick repository against a transactional
      test DB)
- [ ] Add a frontend test that exercises the "no DataType found for source"
      render path (so the UI silently failing is at least covered)
- [ ] Gates: `npm test`, `npm run lint`, `npm run format:check`,
      `npm run check:schemas`, `npm run check:openspec`,
      `npm run check:scala-quality`, `cd backend && sbt test`
- [ ] Playwright verification end-to-end (optional if cycle-2 fix is
      backend-only)
