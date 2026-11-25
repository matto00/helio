## Why

HEL-1518 put the run-open guard into each node's snapshot/history/payload transaction only. Five other writes of a
real run's success chain still rely on the early open-check alone, so a reap that lands after that check lets a
reaped run's late outcome overwrite alert state, binary refs, the schema-drift baseline, Output schemas and the rows
of a write-back dataset, breaking HEL-1511's "first terminal write wins". Separately, the run-retention prune can
delete a still-in-flight run row, which turns a healthy run into a discarded 409.

## What Changes

- The per-Output schema update, the trunk binary-ref overwrite, alert evaluation and the schema-drift baseline run
  only after the run's own `succeeded` terminal write won (like `last_run_*` already does), so a reaped run writes none.
- The `upsertsource` write-back transaction takes a run-scoped advisory key first and checks the run is open; the
  reaper try-locks that key and skips (reaps later) a run whose write-back is open. A trip writes nothing and is a late
  finish (no `failed` terminal write, no event, 409/404), not a write-back failure.
- `deleteOldRunsInternal` never deletes a run with `completed_at IS NULL`.
- The reaper spec's "First terminal write wins" requirement is updated to cover every write; the retention requirement
  states that non-terminal runs are never pruned.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-run-reaper`: a tick skips (reaps later) a run whose write-back transaction is open; every success-chain
  write and the write-back are covered against a late reap.
- `pipeline-run-execution`: retention never prunes a non-terminal run.

## Impact

Backend only: `PipelineRunSucceededWrites`, `PipelineRunExecutor`, `PipelineRunRepository` (prune predicate, reaper
try-lock, write-back run-open check), `DataSourceRepository.applyWriteBacks`, `docs/live-draft-preview.md` (Order O*
note), and tests. No API, schema or migration change.

## Non-goals

- Reordering the success chain or making it cross-write atomic.
- Changing the heartbeat, the stale bound, or retention counts (10 newest / 24 h / 300 cap); the reaper changes only
  by skipping a run whose write-back transaction is open.
- The dormant `SparkJobSubmitter` path beyond the shared prune predicate.
