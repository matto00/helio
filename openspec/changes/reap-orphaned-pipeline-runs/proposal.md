## Why

A real run whose process dies mid-run never gets `completed_at`. Three things read that row and stay blocked
forever with no way out but a manual DB edit. The in-flight guard (`completed_at IS NULL`) blocks the pipeline's
dataset-write auto-runs (HEL-1504 keeps them pending), its schedules and its hooks. The owner's concurrency cap
(`status NOT IN (succeeded, failed, dry_run)`) also keeps counting the dead row. helio-news works around this with a
45 s wait-and-rerun.

## What Changes

- A liveness heartbeat. V126 adds `pipeline_runs.heartbeat_at`. Each instance stamps the real runs it is executing,
  on a dedicated 30 s timer that does not depend on the scheduler tick.
- A reaper on the scheduler tick, before the schedule and auto-run passes. One conditional
  `UPDATE ... RETURNING` marks dead runs `failed` with an "abandoned" reason. A run is dead when:
  - its heartbeat is older than `PIPELINE_RUN_STALE_AFTER_SECONDS` (default 600); or
  - it is a legacy row with no heartbeat and `started_at` is older than 1 h.
- For each reaped run, the reaper:
  - sets `pipelines.last_run_status` to failed when this was the latest run;
  - logs one WARN line;
  - publishes a terminal `failed` run-status event.
- First terminal write wins. Run terminal updates become conditional on `completed_at IS NULL`. A run that finishes
  after it was reaped logs a WARN and skips its snapshot, history and alert writes.
- Tests: a red-first repro of the orphan blocker, a direct test of the 1 s Retry-After floor, a test of several
  writes during one in-flight run, and a non-vacuous final assertion for HEL-1504 case (d).
- The `Superseded` re-arm DEBUG line names both causes: a fresh write, or a stale claim taken over by another
  instance.

**Behaviour change / data effect:** on the first deploy, existing stuck prod runs older than 1 h are marked
`failed` automatically. The owner approved this in the HEL-1511 escalation (Q5).

## Capabilities

### New Capabilities
- `pipeline-run-reaper`: run liveness heartbeat, stale-run reaping, and first-terminal-write-wins.

### Modified Capabilities

## Impact

- Backend only: `PipelineRunRepository`, `PipelineRunExecutor`, the terminal and succeeded write paths,
  `PipelineSchedulerService`, `PipelineAutoRunDebounceFirer` (log text), `Main` wiring, and the V126 migration.
- New env var `PIPELINE_RUN_STALE_AFTER_SECONDS`, added to the CLAUDE.md env table.
- No API or schema contract change, and no frontend change.

## Non-goals

- Splitting `PipelineRunRepository` (HEL-1511 item 3; stays open, overlaps HEL-1503).
- Owner-facing alerts or notifications for reaped runs (Q3).
- A new run status value (Q2).
- A run-level execution timeout. A live run is never reaped, however long it runs.
