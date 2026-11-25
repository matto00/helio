## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `06981bc2b40e44bce941bdcba26330da60e75835`. The base was resolved live with `resolve-review-base.sh`, giving `7292f77d60ff9f46cf3fc94ce83c1f110b92139f`. The diff `BASE...HEAD` is 3 commits:

- `c7a7319dc`: red tests
- `8f26c320a`: implementation
- `06981bc2b`: cycle-2 test hardening

This is a backend-only change, so step 4 (UI) does not apply. I started no server. Logs are under `/home/matt/Development/helio/.concertino/scratch/HEL-1541/skeptic-*.log`.

### What I verified (with evidence)

**AC1: the write inventory and its coverage.** I read the chain from `PipelineRunExecutor.onRunSuccess` through `unblockedChain` and `PipelineRunSucceededWrites.onUnblockedRunSuccess` myself.

- **W1, the write-back:** `applyWriteBacks` now runs `runOpenGuardAction` FIRST inside its own `withUserContext(...).transactionally` (DataSourceRepository.scala ~584).
  - The guard takes the shared two-int4 advisory key, then does a plain `completed_at IS NULL` read. It fails with `RunNoLongerOpen` before any write.
  - `unblockedChain` re-raises `RunNoLongerOpen` ahead of the `NonFatal` write-back-failure arm, so the run goes to `lateFinisher` and gets no `failed` terminal write.
- **W3, W4, W5 and W10:** these are no longer eager `val` futures.
  - Each is now a `def`, started only inside one `afterTerminalWin(runId, "succeeded", won)`, after `materializedWrites` settled and `updateRun` returned.
  - That conditional `completed_at IS NULL` UPDATE is an equivalent, stronger guard: once it wins, the run cannot be reaped.
  - W3 is now collected per committed node (`committedSchemas`) and applied only in the gated group.
- **W2 (node writes):** unchanged, still under the HEL-1518 guard.
- **W7, W8, W9:** were already gated on the win.
- **Blocked path:** `onBlockedRun` gates its writes on the win as well.
- **W11 (insight trigger):** fires only after a published success.

I found no uncovered success-chain write.

**AC2: a reaped run writes nothing; first terminal write wins.**

- Covered by `LateRunWritesGuardSpec` 3.1 (W3, W4, W5 firing and resolve, W10 for owner and editor) and 3.2 (W1, and the case where the write-back committed before the reap). All answer 409 and leave the run `failed` from the reaper.
- W6 is still the conditional UPDATE.
- The log line is `lateFinisher`'s WARN. The `afterTerminalWin` skip WARNs are pre-existing diagnostics (design D9).

**AC3: the prune.** `deleteOldRunsInternal` now adds `r.completedAt.isDefined`, and ranking is unchanged. The five re-seeded retention tests carry stated reasons.

**AC4: red-first and mutations.**

- `c7a7319dc` contains only test, spec and red-run files. No `backend/src/main` file is in it (`git show --stat`).
- `red-run-section3.txt` shows 12 reds: W3, W4, W5 ×2, W10 ×2, W1 ×2, reaper, 3.7a, and prune ×2.
- Post-red test edits (`git diff c7a7319dc HEAD -- backend/src/test`):
  - `seedWriteBack` moved into the base class.
  - 3.2's event assertion was narrowed from "no events" to "no failed/succeeded event", which is justified because `queued`/`running` come before the write-back.
  - 3.3 was strengthened to drive the real guard on the RLS app pool.
  - None of these weakens a red.
- I reproduced three mutations myself and restored the tree after each with `git checkout -- backend/src/main`. The worktree is clean.
  1. **Gate removed:** `afterTerminalWin(runId, "succeeded", true)` on the gated group only. 7 LateRunWritesGuardSpec tests went red: W3, W4, W5 firing, W5 resolve, W10 owner, W10 editor, and the write-back-committed case (`skeptic-mut-gate-prune.log`).
  2. **Old prune predicate restored:** in the same run, both new in-flight prune tests went red (9 failed in total).
  3. **Reaper try-lock replaced with `true`:** the 3.3 reaper-skip test went red at LateRunWritesGuardSpec.scala:186, and 12 passed (`skeptic-mut-reaper.log`).
- The tests are deterministic. They use promise gates and seams (`terminalGate`, `afterNodeWrite`, `afterEarlyCheck`, `beforeOutputList`) and pg_stat_activity polling. There are no fixed sleeps as ordering.

**AC5: no migration (none in the diff).** The full backend `sbt testFull` passed, in 6 shards via `HELIO_TEST_SHARD_INDEX=0..5`, `HELIO_TEST_SHARD_COUNT=6`. Every shard ran with `-J-Xmx3g`, `nice -n 19`, `DATABASE_URL=helio_hel1541` exported in the same command and `ANTHROPIC_API_KEY` empty. Every shard exited 0:

| Shard | Suites | Passed | Failed | Canceled |
| ----- | ------ | ------ | ------ | -------- |
| 0 | 126 | 1758 | 0 | 1 |
| 1 | 128 | 1346 | 0 | 3 |
| 2 | 131 | 2268 | 0 | 1 |
| 3 | 134 | 1348 | 0 | 0 |
| 4 | 135 | 1827 | 0 | 0 |
| 5 | 136 | 1919 | 0 | 0 |
| **Total** | | **10466** | **0** | |

The targeted run of LateRunWritesGuardSpec, RunOpenGuardTeardownSpec, LateFinisherDeleteAfterWonSpec, LateFinisherRunSpec and PipelineRunRepositorySpec gave 75 passed and 0 failed.

**AC6: no behaviour decision needed.** Alert evaluation only writes `alert_events` rows, and gating it on the win skips no external send.

**Deadlock freedom against Order O\*.** The new lock surface is two things:

- the write-back's SHARED advisory key, taken as the first statement, after only `set_config`, so it holds no lock while it can wait;
- the reaper's `pg_try_advisory_xact_lock`, inside a `CASE` so it is evaluated only for open, stale, non-dry rows, and it never waits.

The only waits-for edge is write-back → reaper. The reaper can never wait on the advisory key. The write-back takes no pipeline-row or run-row lock, so no reaper row-lock wait can target it. The reaper's `pipelines` no-key UPDATE does not conflict with the FK KEY SHARE from dataset writes. So no cycle can form.

- W3, W4, W5 and W10 take no new lock; they only move later in the chain.
- The id types match: `pipeline_runs.id` is TEXT (V24), so `hashtext(id)` and `hashtext(runId.value)` hash the same key.
- There is no index regression: no partial index on `completed_at` exists, so the reaper scan is unchanged.
- `RunOpenGuardTeardownSpec` passes, and its control (the round-1 row guard first) raises `40P01`.

### Verdict: CONFIRM

### Non-blocking notes
- `RunOpenGuardTeardownSpec.awaitLockWait` counts `wait_event_type = 'Lock'` across the whole cluster's `pg_stat_activity`. Another lane's lock wait could satisfy it early and make the control flaky. Filtering by `datname = current_database()` would scope it to this lane.
- `LateRunWritesGuardSpec.scala:32` has an orphaned comment: the val it described was removed (the evaluator noted this too).
- Accepted consequence (design D9): a run reaped after some node's W2 committed leaves that node's Output schema older than its rows until the next run.
- `evaluation-2.md` is untracked in the change dir. The orchestrator should commit or discard it before archive.
