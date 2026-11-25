## Standing Constraints

- [C1] Red first: the Tests group (section 3) is written and its red run recorded and COMMITTED (as .txt under this change dir) before any section 1-2 production edit.
- [C2] Deterministic only: drive the reap between the early check and each write with a test hook, the harness's held terminal write (LateFinisherSpecBase `terminalGate`), or ordered transactions; wait on pg_stat_activity lock waits, never sleep.
- [C3] Any app-pool (owner-context) run check (W1 write-back) is proven on an RLS-enforcing pool (Hel1503EditorRunGapsSpec harness), never only a superuser pool; if it cannot read under RLS, escalate.
- [C4] (RETIRED at design gate round 1, superseded by C5/C6) No migration; no change to reaper, heartbeat or retention counts.
- [C6] No migration; no change to the heartbeat, stale bound or retention counts; the only reaper change is the non-waiting advisory try-lock (design D4). (Supersedes round-1 "no reaper change".)
- [C5] No new run-row or pipeline-row lock anywhere (design D1/D7); every new lock is the W1 shared advisory key (first in its transaction) or the reaper's try-lock.

### Backend

## 1. Gate W3, W4, W5, W10 on the run's own succeeded write (design D1, D3)

- [x] 1.1 In `PipelineRunSucceededWrites`, run binary refs (W4), alert evaluation (W5) and the baseline (W10) inside ONE `afterTerminalWin(runId, "succeeded", won)` call instead of as eager siblings
- [x] 1.2 Collect the Output schemas of each node whose write committed; the gated group starts once the fold has SETTLED (success or failure) and W6 returned won, and applies those schemas (W3) there (design D1)
- [x] 1.3 Keep the gated group in `PipelineRunDeletedRecovery`'s siblings (one WARN for a lost run, from the single `afterTerminalWin`)

## 2. Guard the write-back and fix the prune (design D4, D5, D8)

- [x] 2.1 `PipelineRunRepository`: add a `RunOpenClassId` int4 constant and the run-open guard action (`pg_advisory_xact_lock_shared(RunOpenClassId, hashtext(runId))`, then `completed_at IS NULL` read; no row -> `RunNoLongerOpen(Missing)`, terminal -> `RunNoLongerOpen(Terminal)`)
- [x] 2.2 `DataSourceRepository.applyWriteBacks` takes an optional guard, run FIRST inside its owner transaction
- [x] 2.3 `reapStaleRunsInternal`: the WHOLE WHERE becomes `CASE WHEN completed_at IS NULL AND status <> 'dry_run' AND (<heartbeat/legacy stale>) THEN pg_try_advisory_xact_lock(RunOpenClassId, hashtext(id)) ELSE false END`
- [x] 2.4 `PipelineRunExecutor`: pass the guard to the write-back; `unblockedChain` re-raises `RunNoLongerOpen` before the write-back-failure case
- [x] 2.5 `deleteOldRunsInternal` DELETE filter adds `completed_at IS NOT NULL`; ranking unchanged
- [x] 2.6 `docs/live-draft-preview.md` Order O*: note the write-back's run-open advisory key and the reaper try-lock (D7)

### Tests

## 3. Red-first deterministic tests (committed red before sections 1-2)

- [x] 3.1 W3, W4, W5 (firing and resolve; wire an `AlertEvaluationService` into `LateFinisherSpecBase.service()` and seed a rule so firing and resolve really write), W10 (owner and editor run): hold W6 (`terminalGate`), reap, release; assert none written, run failed, no event, 409; plus a case where the write-back committed before the reap: its rows remain, nothing else written
- [x] 3.2 W1: a test seam (an `applyWriteBacks` override that reaps, then calls `super`) reaps after the early check; assert no dataset row written, no `failed` terminal write by the execution, no event, 409
- [x] 3.3 W1 parked inside its transaction (guard param `guard andThen DBIO.from(release.future)`, wait on pg_stat_activity): a reap pass skips the run without waiting; after commit a later pass reaps it (RLS-enforcing pool for the owner read, C3)
- [x] 3.4 GUARD (not red-first; removing the W1 guard creates no deadlock): W1 vs workspace teardown (pipeline + target dataset in the tag) finishes with no `40P01`; its control (round-1 row guard first, parked before (0)) must raise `40P01`
- [x] 3.5 Healthy-run positive controls: every write lands for a never-reaped run (owner and editor), including when W6 commits before the node writes
- [x] 3.6 Prune: an open run outside newest-10/24 h/cap is kept while terminal ones are deleted; re-seed the five `PipelineRunRepositorySpec` retention tests (~158, ~193, ~205, ~338 non-owner no-op, ~349 dry-run records) as terminal runs, reason stated in each test; ~338 also seeds them older than 24 h with an owner-call control proving they would be deleted
- [x] 3.7a Re-express `LateFinisherDeleteAfterWonSpec` "post-fold binary-reference write then fails on the deleted pipeline" (design D3): delete completes before W6 is released; assert the binary write never starts and 404; reason stated
- [x] 3.7 Mutations, each recorded: remove the win gate per write (W3, W4, W5, W10); remove the W1 guard; remove the reaper try-lock; restore the old prune predicate (witness: one unchanged retention test plus 3.6); each turns its test red
- [x] 3.8 Full backend `sbt testFull` in shards, each under the 600 s tool timeout
