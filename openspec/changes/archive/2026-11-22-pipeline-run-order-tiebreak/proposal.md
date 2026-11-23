## Why

Pipeline runs and their assertion results are ordered by timestamp alone, and assertion lists are not ordered at
all. Two runs with an equal `started_at` come back in either order, so "the latest run" (run-history's first entry,
`context-details`' latest-run assertions, `runs/latest`, `panel-status`'s invalid badge, provenance) can flip between
requests. Assertion failures render in whatever order Postgres returns them. HEL-1619's MCP parity goldens rely on
these reads being deterministic.

## What Changes

- Every repository read that orders `pipeline_runs` by `started_at` adds `id` as a same-direction tie-break:
  `ORDER BY started_at DESC, id DESC`. This covers run history (owner-scoped and internal), `runs/latest`, the
  latest non-dry run (assertion-status, panel-status, provenance), the HEL-1619 batch latest-run map, the Home
  summary's run list, and both retention passes' keep sets.
- The HEL-1511 reaper's "no newer non-dry run" test uses the same `(started_at, id)` ordering, so `last_run_*` agrees
  with the latest-run rule when timestamps tie.
- Every assertion-result read gains `ORDER BY created_at ASC, id ASC`. New assertion rows get ids that sort in
  evaluation order within their run, so the order users see today (evaluation order, by accident of heap order)
  becomes guaranteed for new runs and deterministic for old ones.
- Failing-first tests with same-timestamp runs and same-key assertions, per read.

## Capabilities

### New Capabilities
- `pipeline-run-deterministic-order`: a total, deterministic order for pipeline runs and their assertion results
  across every read that lists them or picks a latest run.

### Modified Capabilities

## Impact

- `PipelineRunRepository`, `HomeSummaryRepository` (Scala, backend only). No API shape, schema or migration change.
- Visible effect: none when timestamps differ; with ties, a stable answer instead of a random one.

## Non-goals

- Making the tie-break mean "more recent": run ids are random UUIDs; there is no sequence column to use.
- A new position/sequence column (migration) for runs or assertions.
- Frontend or helio-mcp changes.
