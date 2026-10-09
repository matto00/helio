## Why

The HEL-1272 retention pass (`thinAndPurge`, plus HEL-1276's node-payload purge in the same gate) runs hourly on the
privileged pool under one advisory lock. Its thin DELETE ranks every row of `output_snapshot_history`, and its age-purge
DELETEs reach the owner's tier only through `pipeline_id` and filter on `captured_at`; no index leads with either. It was only ever timed on a 40-day test fixture (~20 ms).
Before history volume grows multi-tenant we need measured plans, a per-tick cost, and an index where one would bound
a full scan.

## What Changes

- Measure, in a dedicated scratch database migrated to origin/main's head, `EXPLAIN (ANALYZE, BUFFERS)` of every
  DELETE the retention tick issues (history age purges, history thin, payload purges) at tractable steady-state and
  backlog volumes, and extrapolate to the ticket's projected volume with stated assumptions.
- Commit the reproducible seed/measure SQL so the numbers can be re-run.
- If a DELETE seq-scans the full table where a btree would bound it, add that index in migration `V120` and record
  before/after plans. Otherwise ship measurement only.
- Record the per-tick cost and a verdict on the hourly cadence and the advisory lock.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

_None._ An index is not observable behaviour; retention semantics (`output-history-retention`) are unchanged.
`skip_specs: true` is set.

## Impact

- `backend/src/main/resources/db/migration/V120__*.sql` (conditional, index only).
- A new measurement script under `backend/scripts/perf/` (not on any runtime path).
- No Scala, API, schema-contract, or frontend change.

## Non-goals

- Rewriting the thin DELETE to avoid ranking the whole table, or changing the cadence/lock. If the measurement says
  either is needed, that is recorded as a verdict and a follow-up, not done here.
- Measuring on the production database.
