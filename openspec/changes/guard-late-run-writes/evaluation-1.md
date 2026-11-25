## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `8f26c320a2edbadd413e3abf958cd7d3245a7acd` (red-first `c7a7319dc`, implementation `8f26c320a`) against live-resolved base `7292f77d60ff9f46cf3fc94ce83c1f110b92139f`.

### Phase 1: Spec Review — PASS

- AC1: inventory present in design.md. W3/W4/W5/W10 are gated behind the run's own winning `succeeded` write in one `afterTerminalWin` (`PipelineRunSucceededWrites.scala`, `gatedWrites`). W1 has a run-open advisory guard placed first in its owner transaction (`DataSourceRepository.applyWriteBacks` `guard`, `PipelineRunRepository.runOpenGuardAction`). Matches CONFIRMed D1/D4.
- AC2: the trip routes to `lateFinisher` (D5 re-raise arm in `PipelineRunExecutor.unblockedChain`). Asserted by the 409 + no-terminal-event cases. First terminal write wins still holds.
- AC3: the prune filter adds `r.completedAt.isDefined`. Ranking is unchanged.
- AC4: red run committed before production edits (`c7a7319dc` contains tests and `red-run-section3.txt` only). See Phase 2 for the one mutation gap.
- AC5: no migration. The full suite is green (Phase 2).
- AC6: alerts write only `alert_events`. Nothing needed escalating.
- Tasks: all ticked and match the code. The 3.3 deviation is judged under Phase 2.
- Spec deltas: the reaper "Stale non-terminal runs are reaped as failed" MODIFIED requirement now carries the open-write-back exception (skeptic note 1 folded in). "An in-flight run is never pruned" is added.
- CONSTRAINTS: C1 (red first) honored. C2 (deterministic) honored; the teardown spec's 25 ms loop polls `pg_stat_activity`, as allowed. C5 holds: no new row lock, only the shared advisory key and the reaper try-lock. C6 holds: no migration; the only reaper change is the CASE try-lock.
- C3 (RLS) is satisfied for the run-state READ. The harness app pool is `SET ROLE helio_app_test_output_history` (NOSUPERUSER, non-BYPASSRLS, `OutputHistoryApiHarness.scala:65-91`), and `DbContext.withUserContext` runs on that pool. The real guard is reached through the real executor in two cases:
  - 3.2 "write no dataset row ... answer 409" can only answer 409 (not 404) if the owner-context read SEES the reaped row under RLS.
  - 3.5 "land the write-back rows for a never-reaped run" can only succeed if the read sees the open row.
  - The lock half of the guard is not covered under C3 or anywhere else. See CR1.

### Phase 2: Code Review — FAIL

Gates run fresh by the evaluator, lane DB `helio_hel1541`, `nice -n 19`, `-J-Xmx3g`. Logs are under `/home/matt/Development/helio/.concertino/scratch/HEL-1541/eval-*.log`.

- Targeted specs: 137 passed, 0 failed (`eval-targeted.log`). The specs run were LateRunWritesGuardSpec, RunOpenGuardTeardownSpec, LateFinisherDeleteAfterWonSpec, LateFinisherRunSpec, LateFinisherSeamIsolationSpec, PipelineRunRepositorySpec, PipelineRunOrderTiebreakSpec, RunReaperConcurrencySpec, OrphanedRunReaperSpec, LiveRunReaperSpec and Hel1503EditorRunGapsSpec.
- Full `sbt testFull` in 6 shards (`HELIO_TEST_SHARD_INDEX=0..5`, `HELIO_TEST_SHARD_COUNT=6`; the build verifies the partition is exact): 1758 + 1346 + 2268 + 1348 + 1827 + 1919 = 10466 passed, 0 failed. Each shard ran in 182-286 s. The 5 canceled tests are the opt-in `HELIO_MEASURE` heap measurements.
- `npm run check:scala-quality` is clean. Only soft size warnings, all on files that were already over budget. `check:openspec` and `check:spec-structure` pass.
- Mutation reproduced by the evaluator: W1 guard removed (`Option(pipelineRunRepo).map(_.runOpenGuardAction(runId))` replaced by `None`). Result: "write no dataset row, no terminal write of its own and no event, and answer 409" FAILED (`eval-mut-W1.log`). The file was restored and the tree is clean. This also validates deviation (1): the one-shot `runStateInternal` hook does land between the early check and the write-back.
- Mutation probe by the evaluator: drop the advisory lock from the REAL guard, keeping the read. In `runOpenGuardAction`, `sql"SELECT count(*) FROM (SELECT pg_advisory_xact_lock_shared(...)) k"` became `sql"SELECT 1"`. Result: LateRunWritesGuardSpec, RunOpenGuardTeardownSpec, RunReaperConcurrencySpec and Hel1503EditorRunGapsSpec ran 31 tests, all passed (`eval-mut-nolock.log`). The file was restored.

Executor deviations judged:

1. Reap hooked on the first `runStateInternal` call instead of an `applyWriteBacks` override: **accepted.** The W1 mutation reproduction proves the hook lands between the early check and the write-back, so the test is not vacuous.
2. Test 3.3 holds the key with raw SQL instead of the real guard: **rejected; this is CR1.** The run-state read under RLS is covered by the 3.2/3.5 cases, as the executor says. But no test anywhere runs the real `runOpenGuardAction`'s advisory lock against the reaper. The design's D4 mechanism for the window INSIDE the write-back transaction is therefore unwitnessed: dropping the lock, or giving the guard a key that differs from the reaper's (another class id, or `hashtext` of another value), keeps every test green. Task 3.3 specified the real seam (`guard andThen DBIO.from(release.future)`). The teardown spec does use the real guard, but it never runs a reap.
3. No unchanged retention test witnesses the old prune predicate: **accepted.** Under the old predicate an in-flight run is deleted. Only a test that seeds an in-flight run can observe that, and the five pre-existing tests were deliberately re-seeded as terminal runs per D8. The two new prune tests go red under PRUNE (`mutations-red.txt`). The task wording "witness: one unchanged retention test" cannot be met by construction. `:181` (40 runs over 20 h, all kept) passes both ways and is the unchanged control.

Other checks:
- Readability defect, `PipelineRunRepository.scala:771-777`. The new `RunOpenClassId` scaladoc and val were inserted between the existing `/** HEL-1518: where a run stands. ... */` comment and `sealed trait RunState`. The HEL-1518 doc now sits orphaned above another doc comment, and `RunState` has lost its scaladoc. See CR2.
- DRY, modularity, error handling: fine. The gated group settles every part before it fails (`transform(Success(_))`), so no sibling is left in flight. It is a `deletedRecovery` sibling. `committedSchemas` is collected only after a node's commit (`replace.map`).
- Type safety, security: no escape hatches. The SQL is interpolated with bind parameters (`$RunOpenClassId`, `${runId.value}`).
- No dead code, TODO or FIXME.

### Phase 3: UI Review — N/A

There are no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The changed files are backend Scala, docs and the change dir.

### Overall: FAIL

### Change Requests

1. **Prove the REAL write-back guard's advisory lock against the reaper (task 3.3 as specified; design D4; C3).** In `backend/src/test/scala/com/helio/services/pipelines/LateRunWritesGuardSpec.scala`, change test 3.3 ("skip, without waiting, a run whose write-back transaction holds its run-open key ...").
   - Replace the raw-SQL `pg_advisory_xact_lock_shared` holder on the privileged pool with a write-back driven through the real guard on the RLS-enforcing app pool, as the owner. For example: `dataSourceRepo.applyWriteBacks(owner, Vector(write), stepRepo, 1000, Some(runRepo.runOpenGuardAction(PipelineRunId(runId)).andThen(park(inTx, release))))`, with the same `park` shape `RunOpenGuardTeardownSpec` uses and a target dataset from `seedWriteBack()`.
   - Then assert that a reap pass during the park does not contain `runId` and leaves it `queued`, that the released write-back commits its row, and that a later pass reaps the run.
   - Record a new mutation in `mutations-red.txt` that removes the `pg_advisory_xact_lock_shared` statement from `runOpenGuardAction` (`PipelineRunRepository.scala:379-380`) and keeps the read. It must turn this test red. (Today it does not: evaluator probe, `eval-mut-nolock.log`, 31/31 green.)
   - Keep the existing REAPER mutation red as well.
2. **Fix the displaced scaladoc** at `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala:771-777`. Move the `RunOpenClassId` doc and val ABOVE the `/** HEL-1518: where a run stands ... */` comment, so that comment sits directly on `sealed trait RunState` again.

### Non-blocking Suggestions

- `LateRunWritesGuardSpec` relies on the harness app pool enforcing RLS (the class doc says so) but never calls the harness's `assertAppPoolEnforcesRls()`. Calling it once in `beforeAll`, or in the 3.2 case, would make the C3 claim fail loudly if the harness role ever gained BYPASSRLS.
- `PipelineRunExecutor.scala` `applyPendingWriteBacks`: the new `dataSourceRepo.applyWriteBacks(..., Option(pipelineRunRepo).map(_.runOpenGuardAction(runId)))` call is one ~170-character line. Binding the guard to a local `val` first would read better.
