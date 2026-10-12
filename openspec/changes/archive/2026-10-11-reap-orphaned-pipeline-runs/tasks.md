## Standing Constraints

- [C1] Tests are red first. New DB specs use `VerifiedEmbeddedPostgres.start` and the `Clock` seam, with no sleeps. `[hel1468-guard]` must appear in the sbt output.
- [C2] No inline FQNs. No `--no-verify`/`HUSKY=0`/hooksPath override. Commit messages are prefixed `HEL-1511`, with no session link and no Claude-Session trailer.
- [C3] Item 3 (the `PipelineRunRepository` split) is out of scope. Keep additions to that file minimal.

## 1. Repro (red first)

- [x] 1.1 Add `OrphanedRunReaperSpec` (a, b, c), per design Planner Notes (R5). The fake clock starts at real now. The orphan row is inserted by raw SQL without naming `heartbeat_at` (`queued`, `completed_at` NULL, `started_at` = now-2h). (a) A pending auto-run on the orphan's pipeline fires on the next tick. (b) A due schedule on that pipeline fires. (c) A different pipeline of the same owner is auto-run with the cap full (orphan plus other in-flight rows). Run it on unmodified main and record the red output in the evidence dir: assertion failures, not exceptions.

### Backend

## 2. Heartbeat

- [x] 2.1 Add migration V126 `pipeline_runs.heartbeat_at TIMESTAMPTZ NULL` (re-check the number vs origin/main) and the Slick column. `insertRunRowAction` sets it to `started_at`. Verify with compile + the existing PipelineRunRepository specs.
- [x] 2.2 Add an injected `LiveRunTracker` (owned by `PipelineRunService`, defaulted). Register/deregister in `PipelineRunExecutor.executeRun` (deregister on every exit path) and in `SparkJobSubmitter.submit`. Verified by the 4.x tests.
- [x] 2.3 Add `PipelineRunRepository.stampHeartbeatsInternal` (`withSystemContext`, one conditional UPDATE), `RunHeartbeatService.stampOnce(now)` and `RunHeartbeatActor` (30 s self-arming timer), wired in `Main` with the run service's tracker. Verify by compile + test 4.2.

## 3. Reaper, first-terminal-wins, logging

- [x] 3.1 Add `PipelineRunGuardConfig.staleRunAfterSeconds` (env `PIPELINE_RUN_STALE_AFTER_SECONDS`, default 600, floor 90 with WARN fallback) and a CLAUDE.md env-table row. Verify with a config unit test.
- [x] 3.2 Add `PipelineRunRepository.reapStaleRunsInternal` (the single CTE statement of design D2, latest-run `last_run_*` update, owner join). Verify with test 4.3.
- [x] 3.3 Make `PipelineSchedulerService.tick()` reap first (recovered), log WARN per run and publish a terminal `failed` via the optional registry, then run the existing work. Wire the registry in Main. Verify with 1.1 going green.
- [x] 3.4 Make the terminal updates conditional on `completed_at IS NULL` and return Boolean. Add the `isRunOpenInternal` check in `onRunSuccess` BEFORE `applyPendingWriteBacks`, which skips the whole success chain (design D4). Failure, blocked and write-back paths skip `last_run_*` and assertions when not updated. Verified by OrphanedRunReaperSpec (repository-level conditional-update cases) and LiveRunReaperSpec (late finisher 4.4, reaped-then-failed, reaped-then-blocked); mutations hel1511-mutation-3.4-*.txt.
- [x] 3.5 Reword the `Superseded` DEBUG line and its scaladoc (design D6). Verify with grep.

### Tests

## 4. Reaper tests

- [x] 4.1 Make `OrphanedRunReaperSpec` (1.1) green. Add: a legacy NULL-heartbeat row at 30 min is not reaped, at 61 min it is; reaped rows have status `failed`, `completed_at`, the reason, and `last_run_status` failed only when latest.
- [x] 4.2 Live long run is never reaped. A real `PipelineRunService` with a backend blocked on a Promise; the clock starts at real now and is advanced past 10× the bound with `stampOnce` between ticks; it stays open. The Promise then completes, and the run is `succeeded`. Record the mutation (skip the register call) actually going red.
- [x] 4.3 Multi-instance (design R2 lock-wait proof). (i) Heartbeat-vs-reap: the reap is blocked on B's uncommitted heartbeat (confirmed via `pg_stat_activity`), B commits, and the reap returns 0. (ii) Reap-vs-reap: B's uncommitted reap blocks a second reap, B commits, and the second returns 0. Record the SELECT-then-UPDATE mutation going red.
- [x] 4.4 Late finisher. The gate hands off to the REAL `InProcessExecutionBackend` (pattern: `PipelineRunServiceTerminalOrderingSpec.GatingBackend`, not the empty-outcome `GatedExecutionBackend`). The pipeline has an `upsertsource` step, so a real deferred write-back and real node outcomes exist; it binds an Output to a node (snapshots are written only for Output-bound nodes). Reap the run while it is gated (clock at real now + more than the bound, no stamps), then release it. Assert: the row stays `failed`; `node_snapshots`, history and the write-back target dataset are unchanged; `last_run_status` stays failed. Positive control: the same fixture, NOT reaped, writes the target dataset row and a snapshot. Record the mutation (remove `isRunOpenInternal`, or move it after `applyPendingWriteBacks`) going red.

## 5. HEL-1504 test gaps (item 2)

- [x] 5.1 Retry-After floor test (design D5 i), red under the `max(1L, …)` removal mutation.
- [x] 5.2 Three writes during one in-flight run: no run while in flight, then exactly one auto-run after completion (D5 ii).
- [x] 5.3 Replace case (d)'s vacuous last assertion with the reset-while-re-armed check (D5 iii), red under the reset-removal mutation.

## 6. Gates

- [x] 6.1 `nice -n 19 sbt testFull` green with `[hel1468-guard]` in the output. Pre-commit hooks pass. Record mutation runs (4.2, 4.3, 4.4, 5.1, 5.3) in the evidence dir.
