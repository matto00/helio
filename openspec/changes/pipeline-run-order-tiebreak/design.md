## Context

`pipeline_runs.id` and `pipeline_run_assertions.id` are `TEXT` primary keys filled with `UUID.randomUUID()`
(`PipelineRunExecutor`, `PipelineRunService`, `PipelineRunRepository.insertAssertions`). Neither table has a sequence
column. `pipeline_runs` has index `pipeline_runs_pipeline_started_idx (pipeline_id, started_at DESC)` (V136);
`pipeline_run_assertions` has `(run_id)` (V84). All assertion rows of a run are inserted in one `++=` batch, so they
share `created_at` (`DEFAULT now()`, the transaction start).

## Goals / Non-Goals

**Goals:** one total order per read, the same latest-run answer from every read, and tests that fail without the fix.
**Non-Goals:** a "true recency" tie-break (no column carries it); a migration; API or client changes.

## Decisions

### D1. Runs: `started_at DESC, id DESC`
Same direction as the primary key so the order is a plain lexicographic descent (and a row-value comparison
`(started_at, id) > (...)` expresses "newer" in the reaper). Ids are random UUIDs, so `id DESC` picks an arbitrary but
fixed winner, not the more recent run; the PR says so. Alternatives: `completed_at` (null while running, and
equal-or-later completion says nothing about which started later), `ctid` (not stable across VACUUM FULL / updates).
No sequence column exists; adding one is a migration for a Low ticket with no product need for "true" order.

### D2. Assertions: `created_at ASC, id ASC`, plus ordered ids for new rows
Today assertion reads have no `ORDER BY`; users see heap order, which is in practice evaluation order, and
`RunHistoryModal` renders `failures` in returned order. Ordering by random UUID alone would make the order
deterministic but scramble that. So `insertAssertions` generates ids as `<one random UUID per batch>-<index padded to
5 digits>` (e.g. `3f…-00000`, `3f…-00001`). Within a run all rows share the prefix, so `id ASC` equals evaluation
order; across legacy rows the order is deterministic, if arbitrary. Assertion ids are not exposed by any API
(`AssertionFailureDetail` has no id) and the column is `TEXT`, so the format change is invisible outside the table.
Alternatives: `(step_id, kind, field, id)` (deterministic, but reorders what users see today and groups by an
arbitrary step id); a `position` column (migration).

### D3. Inventory: reads changed

All in `PipelineRunRepository` unless noted.

| Read | Feeds | Change |
|---|---|---|
| `listByPipeline` (owner, RLS context) | no production caller (consistency) | runs order |
| `listByPipelineInternal` | `GET .../run-history` | runs order |
| `latestRunInternal` | `GET .../runs/latest` | runs order |
| `latestNonDryRunInternal` | assertion-status, `panel-status` (HEL-1786), provenance | runs order |
| `latestRunIdsInternalBatch` | `context-details` (HEL-1619) | runs order (first-seen per pipeline) |
| `deleteOldRunsInternal` (`newestN`, `capped`) | which runs survive into run-history | runs order |
| `deleteOldDryRunsInternal` (`keepIds`) | same, dry runs | runs order |
| `reapStaleRunsInternal` `NOT EXISTS` | `last_run_*` after a reap (HEL-1511) | `(n.started_at, n.id) > (r.started_at, r.id)` |
| `HomeSummaryRepository.load` (RLS context) | Home recent runs / attention | `ORDER BY r.started_at DESC, r.id DESC` |
| `listAssertionsByRun` (RLS; no production caller), `listAssertionsByRunInternal`, `listAssertionsByRunsInternalBatch` | run-history, context-details, assertion-status, provenance | assertions order |
| `insertAssertions` | ids of new rows | D2 id format |

### D4. Inventory: reads left alone (reasons)
- `PipelineContextAnalyzeReads` / `context-analyze` (HEL-1625): reads steps and analyze projections, no runs.
- `latestSuccessfulCompletedAtInternal`: `max(completed_at)`, a scalar, no tie to break.
- `hasActiveRunInternal` / `findActiveRunInternal`: at most one open run per pipeline (overlap guard); no order.
- `last_run_*` on normal terminal writes: written by the finishing run itself, no "latest" query; only the reaper
  compares runs.
- `HomeSummaryBuilder` in-memory `sortBy`/`maxBy`: stable sort and first-max over the now-deterministic SQL order.
- `deleteOldRunsInternal`'s `inWindow` set: a filter, not an order.
- `OutputInsightRepository`, `AuditEventRepository`: already tie-broken; not run/assertion reads.

### D5. Indexes
Adding `id` to `ORDER BY ... LIMIT 1` may stop V136 satisfying the sort alone (an incremental sort over equal
`started_at` keys). The executor records `EXPLAIN (ANALYZE)` for `latestRunInternal` and `listByPipelineInternal` on
the lane DB; an index (V147) is added only if the plan regresses measurably. Expected: no index (runs per pipeline
are capped by retention at about 20).

## Risks / Trade-offs

- `id DESC` as the winner is arbitrary; a reader might assume it means "newer". Mitigated by comments and the PR.
- Assertion id format change: any code parsing assertion ids as UUIDs would break; the executor greps to confirm none.
- Tests must force equal timestamps explicitly (insert with a fixed `startedAt`); a test relying on clock collisions
  would pass by luck. Red must be demonstrated with ids chosen so the un-tie-broken order is wrong (e.g. insert the
  greater id first and assert it still comes first, plus the converse), and by mutation (drop the tie-break).

## Planner Notes

- Legacy assertion rows (written before this change) will sort by their random UUIDs, which differs from the heap
  order users saw; deterministic, and retention ages them out. State this in the PR (design gate note 6).

- Self-approved D2 (assertion id format) over the semantic-key alternative: it keeps today's visible order. Flagged
  for the design gate.
- No escalation: no external dependency, API change or scope beyond the ticket.
