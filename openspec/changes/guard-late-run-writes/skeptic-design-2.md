## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 7292f77d60ff9f46cf3fc94ce83c1f110b92139f. The change dir is untracked; I read the artifacts as they are on disk (ticket.md, proposal.md, design.md, tasks.md, both spec deltas, skeptic-design-1.md) and checked them against the live source.

### What I verified (with evidence)

- **D1 (gate W3/W4/W5/W10 on the run's own `succeeded` win) is sound in production code.**
  - `afterTerminalWin` (`PipelineRunTerminalWrites.scala:65-70`) runs the work only when `won`.
  - `updateRunTerminalInternal` (`PipelineRunRepository.scala:327-341`) is conditional on `completed_at IS NULL`. The reaper's predicate requires `completed_at IS NULL` too (`:409`). So once W6 has won, the run cannot be reaped.
  - A lost W6 (reaped, or cascaded away by a pipeline delete) means none of the gated writes start.
  - The HEL-1564 recovery (`PipelineRunDeletedRecovery.scala:35-55`) still applies after a win: W4's FK failure is recovered, W3 on deleted Outputs touches 0 rows, and W10 and W5 already `recoverWith`.
  - **Alert baselines.** `AlertEvaluationService.scala:125-146` excludes the triggering run's own history point (`HistoryBaseline.eligible(recent, runId, k)`), whether or not that point is written yet. Moving W5 after W6 (which is still concurrent with the fold) does not change any baseline.
  - **HEL-1739 auto-run cancel, `last_run_*` and assertions** were already gated (`PipelineRunSucceededWrites.scala:260-283`).
  - **Insight trigger** fires only on the published success (`:342-346`). Unchanged.
  - **Panel freshness** keys on history `dataUpdatedAt` (W2). Unchanged.
- **D4 deadlock analysis.** I re-derived it.
  - The write-back holds nothing when it waits on the shared key, because the key is its first lock.
  - The reaper's try-lock never waits. While the reaper waits on a run-row lock (a HEL-1518 node guard `FOR SHARE`, or a W6 UPDATE), it holds exclusive keys only for runs whose write-back has not started. A write-back for such a run waits holding nothing, so there is no cycle.
  - The NewSource path (`rewriteUpsertTargetAction`) still takes (2)/(3) after the key. Neither the reaper nor a teardown ever waits on the key.
  - I found no new cycle against the reaper, pipeline delete, workspace teardown, the draft save, dataset writers or the HEL-1518 node guard, apart from the hash-key collision in CR3.
  - **READ COMMITTED.** If the reaper commits first, the write-back's shared lock waits for that commit. Its later plain read is a new statement snapshot, so it sees `completed_at` set and trips. If the write-back holds the key first, the try-lock fails and the row is filtered out. An EPQ re-check after a concurrent heartbeat or terminal write can leave an acquired key held until the reaper's single-statement transaction commits. That is harmless.
- **RLS for the owner-context run read.**
  - `pipeline_runs_owner` (V35:77-84) admits rows whose pipeline `owner_id = app.current_user_id`.
  - `applyWriteBacks` runs under `withUserContext(owner)` with the pipeline owner, editor runs included (`PipelineRunExecutor.scala:494-505`, `DataSourceRepository.scala:550-590`). The read is visible.
  - It only recovers `IllegalStateException`, so `RunNoLongerOpen` (a `RuntimeException`) reaches `unblockedChain`'s `NonFatal` arm (`PipelineRunExecutor.scala:459-466`). D5's re-raise is needed, and with `onRunSuccess`'s `recoverWith` (`:415-416`) it is sufficient.
- **D8.** `deleteOldRunsInternal` (`PipelineRunRepository.scala:500-526`) has no `completed_at` predicate, as claimed. `PipelineRunOrderTiebreakSpec`'s `run` helper seeds `succeeded` rows with `completed_at` set (`:55-59`), so it is unaffected.
- **Test-plan feasibility.**
  - `LateFinisherSpecBase` provides `terminalGate`, `beforeNodeFold` and `beforeOutputList`, plus hooks on binary refs and snapshots (`:84-145`). 3.1 is deterministic under D1.
  - Each per-write "remove the gate" mutation makes the write land whatever the timing, so each turns red reliably.
  - 3.3 can park the write-back deterministically: a test session holds the target `data_sources` row `FOR UPDATE`, the write-back waits at lock (0) after taking the key, and the test watches `pg_stat_activity`.
  - The 3.4 control (the round-1 row guard first, parked before (0); teardown (0)/(1)/(3), then `DELETE pipelines` waits on `KEY SHARE`; release) reproduces `40P01` deterministically.

### Verdict: REFUTE

### Change Requests

1. **D1 makes an existing HEL-1564 regression test hang, and leaves a spec clause unreachable. The plan mentions neither.**
   - **The test.** `LateFinisherDeleteAfterWonSpec.scala` "answer 404, publish no succeeded and leave no run row when a post-fold binary-reference write then fails on the deleted pipeline" (about lines 127-141) sets `terminalGate = deleted.future` and completes `deleted` only inside `beforeBinaryWrite`. Under D1 the binary write starts only after W6 returns, and W6 is held until `deleted`. That is a circular wait, so the test hangs until its timeout.
   - **The spec clause.** The reaper delta keeps, under "Pipeline deleted while its run executes" (W6 lost), "AND this holds also when a later write of the success chain (for example a binary reference) fails because the pipeline is gone". Under D1 no binary-reference write is ever issued when W6 lost, so the example can no longer happen.
   - **Revise:**
     - List this test in tasks.
     - Say what it becomes: for example, "when W6 lost to the delete, the binary-reference write never starts", asserted through the `binaryEntered` hook never completing plus the 404. Say that it is re-expressed on purpose because D1 changed the semantics.
     - Fix the delta's example to a write that can still fail after a lost W6, or drop it.
     - Confirm in the design that the other HEL-1564/HEL-1594 specs still hold. I checked "HEL-1594 D2" and the "narrowness control": both gate the binary write on `terminalWritten`, so they still work.

2. **D8 misses a fourth retention test that goes red, and one that becomes vacuous.**
   - **Goes red.** `PipelineRunRepositorySpec` "deleteOldRuns does not affect dry-run records" (lines 349-368) seeds 12 real runs with `insertRun` (queued, `completed_at` NULL) and asserts 15 rows remain (10 real + 5 dry). Under `completed_at IS NOT NULL` all 12 queued runs survive, so 17 remain.
   - **Becomes vacuous.** "deleteOldRuns is a silent no-op for a non-owner (CS2)" (lines 338-347) seeds queued runs. Under the new predicate nothing is deletable whoever calls, so it passes even with the owner check removed.
   - **Revise:** add both tests to 3.6 and re-seed them as terminal runs, with the stated reason. Otherwise the evaluator meets an unlisted fixture edit, or a guard that can no longer fail.

3. **D4's claim that "the advisory key is in its own namespace" is false. Fix the key and pin the evaluation order.**
   - **Why it is not separate.** `pg_advisory_xact_lock_shared(hashtext(...))` uses the single-`bigint` key space, with a 32-bit hash. That space also holds:
     - the cycle advisory lock (2), `PipelineCycleValidator.AdvisoryLockKey = 72901101L`, which is inside int4 range;
     - the `hashtext('pipeline-run-concurrency:' || userId)` keys.
   - **The cycle a collision creates.** A run whose key hashes to 72901101 makes its write-back hold (2) shared before (0). A draft save holding (0) then waits on (2) while the write-back waits on (0). That is a cycle (about 2^-32 per run, but it breaks the deadlock-freedom argument as written).
   - **Revise D4/2.1/2.3:**
     - Use the two-`int4` key form with a dedicated class id, `pg_advisory_xact_lock_shared(<classid>, hashtext(runId))`, and the same in the reaper's `pg_try_advisory_xact_lock(<classid>, hashtext(id))`. PostgreSQL keeps the single-`bigint` and two-`int4` key spaces apart.
     - Specify the reaper's ordering as `CASE WHEN <stale> THEN pg_try_advisory_xact_lock(...) ELSE false END`. Drop "sub-select": a correlated sub-select is ordered only by cost and is not guaranteed last.

### Non-blocking notes

- **D3 vs AC2 ("log one clear line").** `afterTerminalWin` already logs one WARN per call. Wrapping W3, W4, W5 and W10 separately adds four identical WARNs to the three existing ones. Wrap the gated group in a single `afterTerminalWin` call so that D3's "one WARN per skipped gated write group" means one line.
- **3.4 is a guard, not a red test.** Removing the W1 guard does not create a deadlock, so the new-code case cannot fail first. Only its control proves the harness detects the cycle. Label it so in tasks (see the red-vs-guard rule).
- **D9 should state an accepted consequence.** When a reap lands after a node's W2 committed, that node's snapshot rows stay newer than its Output schema until the next run. Today W3 follows each node right away. `RowColumnOrder` (schema names present in rows, then the other keys) tolerates this, so the effect is cosmetic, but write it down.
- **Execution delta.** "SHALL keep at most 300 rows in all" is no longer strictly true once open runs are exempt. Qualify it: "terminal runs beyond ... are deleted".
- **3.2 needs a seam the harness lacks.** There is no hook between the early check and the write-back today. The test needs one, for example an `applyWriteBacks` override that reaps before calling `super`. Name it in tasks so the mutation "remove the W1 guard" is shown to exercise the guarded path.
