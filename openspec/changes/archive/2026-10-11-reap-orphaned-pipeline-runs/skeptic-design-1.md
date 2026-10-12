## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD: 2e02b79511fab222ac2bc73a142fc61e0979f192 (main; the change dir is untracked planning artifacts only).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/orphaned-run-reaper/hel-1511`.
- **Owner rulings:** read `.concertino/runs/HEL-1511/hel1511-esc1-context.md`. D1 matches Q1 A, D2 matches Q2 A, Q4 A and Q5 A, and D3 matches Q3 A. D4 matches Q6 A for snapshots and history, but not for write-back (CR3).
- **Tick awaits submit:** confirmed. `PipelineSchedulerService.tick()` (:94-130) zips `candidatesWork`, and that runs `fire`, then `gatedSubmit`, then `pipelineRunService.submit` (:209). `PipelineSchedulerActor` (:47-55) arms the next tick only on `TickCompleted`. So a tick-driven heartbeat would stall, and the separate `RunHeartbeatActor` is justified.
- **Insert and admission paths:** `insertRunRowAction` (PipelineRunRepository :82-105) is shared by `insertRunInternal` (Spark `submit` :69 and the `insertRun` owner path used by `recordUnrunnable`), by `countAndInsertAction` (owner cap) and by the grantee cap insert. Setting `heartbeat_at = started_at` there covers every insert. `PipelineRunExecutor.executeRun` admits only on the `Inserted` arm (:159), for both owner and editor. `recordUnrunnable` (PipelineRunService :234-248) inserts and then immediately terminates, so leaving it unregistered is safe within 600 s.
- **Spark:** `SparkJobSubmitter` is also a `PipelineExecutionBackend`, so its `execute` path goes through `executeRun`. Its `submit` path (:55-120) has no caller in the route tree and inserts and terminates its own row. D1's register/deregister there is fine.
- **Cap and in-flight predicates:** the cap is `status NOT IN ('succeeded','failed','dry_run')` (:163-167). `hasActiveRunInternal` is `completed_at IS NULL` (:479-481), and the auto-run firer (:56) and scheduler (:162) both use it. The reaper sets both `status = 'failed'` and `completed_at`, which unblocks all three.
- **PG READ COMMITTED claims:** these are sound for a single-table `UPDATE ... WHERE <predicate>`, including inside a data-modifying CTE. If a concurrent heartbeat commits first, EvalPlanQual re-checks the row against the new `heartbeat_at` and drops it. If one reaper commits first, the other re-checks `completed_at IS NULL` and skips the row. A heartbeat that waits on a committed reap skips the row the same way. No advisory lock is needed, and that agrees with Q4 A.
- **Terminal paths:** I read `PipelineRunTerminalWrites` (`executeRunFailure`, `onWriteBackFailure`, `onBlockedRun`) and `PipelineRunSucceededWrites.writesChain`.
  - `onBlockedRun` builds `updateMeta`, `updateRun` and `assertionsInsert` eagerly and runs them concurrently (:215-223). D4's "terminal update first" therefore means re-sequencing that code. The wording covers it.
  - In `PipelineRunExecutor.onRunSuccess` (:310-323), `applyPendingWriteBacks` runs before `onUnblockedRunSuccess`. Design Context and D4 do not mention it (CR3).
- **Item 2 tests:**
  - `PipelineRunGuardConfig` is a plain case class, so `concurrencyRetryAfterSeconds = 0` can be constructed. The pre-flight path (`PipelineAutoRunDebounceFirer` :110-111) then yields `GuardRejected(0)`, and `fireAt = now + max(1, 0)` (:79). With the floor removed, `fire_at == now` and `claimDue` (`fire_at <= now`) re-claims. So D5(i) can fail under its stated mutation.
  - I read case (d) at `DatasetWriteAutoRunDroppedFireSpec` :284-318. Its final assertion checks a row that was inserted fresh after the DELETE, so the count is 0 by INSERT default and the assertion is vacuous. D5(iii) writes while the row is still re-armed at count >= 1, so removing `guard_retry_count = 0` from `ON CONFLICT` (repo :40-43) makes it fail.
- **Migration number:** `git ls-tree origin/main` shows V125 as the highest migration. V126 is free today.
- **Registry wiring:** `PipelineRunService.eventRegistry` exists (:300), and `PipelineRunRegistry.publish` fans out locally and through NOTIFY (:149-152). D3's wiring is feasible.

### Verdict: REFUTE

### Change Requests

1. **Test 4.2 (AC3), and 4.4 with it, may not fail under the stated mutation.**
   - Why: `executeRun` takes `startAt = Instant.now()` (PipelineRunExecutor :100), the wall clock, not the `Clock` seam. D1 then sets `heartbeat_at = started_at`. But the reap compares against the scheduler's fake `clock.now()`, and the repo's pipeline specs pin `t0 = 2026-01-01` (DatasetWriteAutoRunDroppedFireSpec :175, FireTimeRunConfigGateSpec :96). That is months before the real now.
   - Effect: in a spec written to that convention, a run that was never registered still has `heartbeat_at` at the real now, which is far ahead of `fakeNow - 600 s`. It is never reaped, so the "skip the register call, test goes red" mutation stays green. The same gap means 4.4 cannot reap its run at all unless the clock is ahead of real time.
   - Required: either take `startAt` from `guardClock.now()` in `executeRun` (preferred, because this is the Clock seam C1 requires), or require the 4.2/4.4 clocks to start at or after the real `Instant.now()`. In both cases, record the mutation run actually going red.

2. **Test 4.3 (AC4) must prove the concurrent statement actually waited.**
   - Why: as written ("held uncommitted ... then committed, makes a concurrently waiting reap return 0 rows"), nothing establishes that the reap is blocked on the row lock before the commit. If the reap starts after the commit, it passes with an ordinary snapshot read. A wrong two-statement design (SELECT the stale ids, then `UPDATE ... WHERE id IN (...)`) would then also pass. This test never exercises the EvalPlanQual re-check that the design's whole no-lock argument rests on.
   - Required for both halves (heartbeat-vs-reap and reap-vs-reap):
     - hold the competing row lock in an open transaction on a second connection;
     - start `reapStaleRunsInternal`;
     - confirm deterministically that its backend is waiting, by polling `pg_stat_activity.wait_event_type = 'Lock'` or `pg_locks.granted = false` (polling, not sleeping, per C1);
     - then commit and assert.
   - Also required: name the mutation that must turn it red, for example the SELECT-then-UPDATE split, or dropping `completed_at IS NULL` from the reap's WHERE clause.

3. **First-terminal-write-wins does not cover write-back.**
   - Why: Q6 A says the late finisher must not "overwrite a newer run's data". In the success path, `applyPendingWriteBacks` (`dataSourceRepo.applyWriteBacks`, PipelineRunExecutor :310/:340) runs before `onUnblockedRunSuccess`, and D4 places its open-check inside `onUnblockedRunSuccess`. A reaped, stalled run would therefore still upsert into its target dataset after a newer run already did, and that would trigger the dataset-write auto-run cascade.
   - Required: put the open-check before `applyPendingWriteBacks`, or explicitly justify exempting write-back and add that exemption to the spec's "SHALL NOT overwrite" list.
   - Also required: give D4 a complete disposition for every write in the success chain. Include `baselineUpsert` (`last_source_schema`, PipelineRunSucceededWrites :247-256) and `persistAssertions`; neither is currently listed.

4. **`RunHeartbeatService.stampOnce` must state its DB context.**
   - Why: D2 says the reap runs "under system context", but D1 says nothing about where `stampOnce` lives or which pool it uses. It updates rows across many owners (`id = ANY(live)`). On the RLS-enforced user pool it would match 0 rows in prod. Every run longer than 600 s would then be reaped while it is still live, and its snapshot writes skipped. Dev and CI connect as superuser with BYPASSRLS, so no gate would catch this (see MEMORY "RLS testing parity gap").
   - Required: D1 and task 2.3 must say that `stampOnce` is a repository method run through `ctx.withSystemContext`, the privileged pool, like every other `*Internal` lifecycle write.

5. **Make the red-first repro (task 1.1) unambiguous so it is red for the right reason.**
   - (a) For case (c), put the orphan on a different pipeline of the same owner, with `maxConcurrent` set so the orphan fills the cap (e.g. 1), and assert that pipeline B's due schedule or auto-run fires. With the orphan on the same pipeline, (c) is blocked by the in-flight guard and is indistinguishable from (a)/(b). Then it proves nothing about the cap.
   - (b) Insert the orphan with SQL that does not name `heartbeat_at`. The column does not exist on main, so naming it gives an SQL exception, which is not an assertion failure. The insert must also not go through `insertRunInternal`: after D1 that path sets `heartbeat_at = started_at`, and the spec would silently stop testing the legacy NULL-heartbeat branch it claims to test.
   - (c) Any new `PipelineRunGuardConfig` field (`staleRunAfterSeconds`) and any new `PipelineSchedulerService` constructor parameter (registry) must have defaults, so the unchanged red spec compiles both on main and after the change.
   - (d) The recorded red output must show assertion failures (`runCount ... was 0`), not exceptions.

### Non-blocking notes

- The reason string `no heartbeat for <N> s` is ambiguous for legacy NULL-heartbeat rows, which are reaped at 3600 s, not 600 s. Compute N per row in SQL (`now - coalesce(heartbeat_at, started_at)`) or use a fixed legacy wording.
- Two reapers locking several stale rows in different scan orders can deadlock (40P01). The tick's `recover` contains it and the other reaper still succeeds, so correctness holds. An `ORDER BY id` locking sub-select would remove the noise. At minimum, document it so a deadlock ERROR in logs is not misread.
- The late failure, blocked and write-back-failure paths still publish a terminal `failed` through `publishTerminalAfter`, after the reaper already published one. That is harmless, but consider skipping the publish when the terminal update returned false, matching D4's success path ("publishes nothing").
- Success path: the design gates `updateMeta` only on the open-check, not on `updateRun`'s Boolean. Sequencing `updateMeta` after the conditional `updateRun` closes the documented open-check-to-write race for `last_run_*` at no cost.
- The dormant Spark `submit` path calls `updateLastRunInternal` before `updateRunTerminalInternal` and unconditionally. If it ever gets a caller, it would not be first-write-wins. Note it, or apply the same Boolean gate.
- Under Q4 A (settled), on a single instance the reaper does not run while that instance's tick is awaiting a long scheduled run. Orphans on other pipelines then stay blocked for that long. This is acceptable given the ruling, but say so in Risks.
- Prefer an injected `LiveRunTracker` instance over a global object, so parallel specs in one JVM do not share run-id state.
- D5(ii) should also assert that no run fires while the first run is in flight (the `unclaim` path), not just "exactly one after".
