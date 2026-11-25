## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `06981bc2b40e44bce941bdcba26330da60e75835`. The base `7292f77d60ff9f46cf3fc94ce83c1f110b92139f` was resolved live. The new commit since cycle 1 is `06981bc2b`.

### Phase 1: Spec Review — PASS

- The cycle-1 Phase 1 findings stand. Commit `06981bc2b` changes no planned behaviour.
- Task 3.3 is now implemented as specified: the real `runOpenGuardAction`, followed by a park, runs as the first action of `applyWriteBacks` on the owner's app-pool transaction.
- C3 (RLS on the app pool) is now witnessed for the guard's lock as well as its read. `assertAppPoolEnforcesRls()` runs in `beforeAll`.
- C1, C2, C5 and C6 still hold. No new lock was added, and there is no migration.

### Phase 2: Code Review — PASS

Gates were run fresh by the evaluator against lane DB `helio_hel1541`, with `nice -n 19` and `-J-Xmx3g`. Logs are under `/home/matt/Development/helio/.concertino/scratch/HEL-1541/eval2-*.log`.

**Full `sbt testFull`**, run as 6 shards. The build itself verifies that the partition is exact (`HELIO_TEST_SHARD_INDEX=0..5`, `HELIO_TEST_SHARD_COUNT=6`).

| Shard | Passed | Failed |
| ----- | ------ | ------ |
| 0 | 1758 | 0 |
| 1 | 1346 | 0 |
| 2 | 2268 | 0 |
| 3 | 1348 | 0 |
| 4 | 1827 | 0 |
| 5 | 1919 | 0 |
| **Total** | **10466** | **0** |

- Each shard ran in 175-285 s.
- The 5 cancelled tests are the opt-in `HELIO_MEASURE` heap measurements.
- The rewritten 3.3 test passed in shard 1.

**Code-quality check:** `npm run check:scala-quality` is clean. Its warnings are soft size warnings on files that were already over budget.

**Mutation reproduced by the evaluator: NOLOCK.** I replaced `pg_advisory_xact_lock_shared(...)` in `runOpenGuardAction` with `SELECT 1` and kept the read.
- The rewritten 3.3 test "skip, without waiting, a run whose REAL write-back guard holds its run-open key on the RLS app pool ..." went red at the intended assertion. The reap during the park contained the run id (`LateRunWritesGuardSpec.scala:186`).
- 12 tests passed and 1 failed (`eval2-mut-nolock.log`). In cycle 1 the same mutation left all 31 tests green.
- The file was restored and the worktree is clean.

**CR1 (cycle 1): resolved.**
- 3.3 now seeds the write-back target with `seedWriteBack()`.
- It drives the real guard through `dataSourceRepo.applyWriteBacks(owner, ..., Some(runRepo.runOpenGuardAction(runId).andThen(park)))` on the NOBYPASSRLS app pool.
- It asserts four things:
  - the reap skips the run during the park;
  - the run stays `queued`;
  - the released write-back commits one row;
  - a later reap finalizes the run as `failed`.
- `mutations-red.txt` now has a "CYCLE 2" section recording NOLOCK, REAPER and W1 red against the new test. A guard key that no longer matches the reaper's (another class id or another hash) would now also turn the test red, because the test uses both real code paths.

**CR2 (cycle 1): resolved.** The `RunOpenClassId` doc and val now sit above the HEL-1518 doc, which again annotates `sealed trait RunState` (`PipelineRunRepository.scala:771-776`).

**Cycle-1 suggestions: both taken.** `assertAppPoolEnforcesRls()` is called, and the guard is bound to a local `val` in `PipelineRunExecutor.applyPendingWriteBacks`. That change is behaviour-neutral, and the full suite above ran on it.

### Phase 3: UI Review — N/A

There are no changes under `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

### Overall: PASS

### Non-blocking Suggestions

- `LateRunWritesGuardSpec.scala:32` still has the comment `// The run-open advisory class id the write-back transaction holds and the reaper try-locks (design.md D4).`. The `RunOpenClassId` val it described was removed in this commit, so the comment now annotates nothing. Delete it.
- `evaluation-1.md` was committed into the change dir by `06981bc2b`. That is harmless (it is the cycle-1 report), but the orchestrator may want to confirm this is intended before archiving.
