# HEL-881: URL-backed text/pdf/image sources serve stale content on every scheduled run

## Description

A URL-backed `text`, `pdf` or `image` source never re-fetches on a scheduled run. It serves the content captured at
creation time, forever. `refreshText`/`refreshPdf`/`refreshImage` do re-fetch, but `DataSourceService.refresh` is not
on the scheduled path: a scheduled run goes `PipelineSchedulerService.fire` → `PipelineRunService.executeRun` →
`InProcessPipelineEngine.loadRowsWithStats`, and that last step reads the stored file directly for these source
kinds. HEL-862 fixed exactly this for `csv` by correcting the engine branch; the same branch structure leaves the
other three broken.

This is a live, silent correctness bug in three shipped connectors: the pipeline runs green, the panel renders, and
the content is simply old, with nothing indicating the source did not update. Anyone who sets a schedule on one of
these sources has explicitly asked for fresh data and is silently not getting it.

## Scope

- Fix the engine's load path for `text`, `pdf` and `image` so a URL-backed source re-fetches on a run, mirroring
  HEL-862's `csv` fix.
- Reuse HEL-862's approach rather than reimplementing it three times — prefer one path all four kinds go through.
- Re-run the enumeration rather than trusting the ticket's list — check every source kind the engine loads.
- Verify by an actual run with changing upstream content, not by asserting a refresh function was called.

## Acceptance criteria

- [ ] A URL-backed `text` source whose upstream content changes serves the new content after a scheduled run;
      verified with a real scheduled fire and differing bytes across two runs.
- [ ] The same for `pdf` and `image`.
- [ ] Upload-created (non-URL) sources of all three kinds are unaffected — they must continue serving their stored
      file.
- [ ] The enumeration of source kinds on the engine load path is recorded in the PR, with each kind shown to
      re-fetch or explicitly justified as not needing to.
- [ ] The fix is shared across kinds rather than duplicated per kind, or the decision to duplicate is justified in
      design.

## Run constraints (coordinator, parallel runs in flight)

- **No Flyway migration.** All worktrees share one dev Postgres; a migration from a parallel run poisons
  `flyway_schema_history` for the others. If one is genuinely needed, STOP and escalate.
- **No browser automation.** Parallel worktrees share a single Playwright session.
- **Do not touch** `WorkspaceContextService.scala`, `PipelineService.scala`, `api/protocols/patchsets/**`, or
  `helio-mcp` (owned by HEL-914). Sibling runs own the REST fetch path (HEL-844) and schema inference (HEL-868) —
  escalate rather than absorbing a change that reaches into either.
- Root cause must be established with a probe before fixing; several plausible mechanisms exist and need different
  fixes.
- Widen the repro beyond scheduled runs (manual, preview) and report the true breadth.

## Related

HEL-862 (fixed this for `csv`), HEL-879 (SSRF guard on the same fetch paths), HEL-857 (epic).
