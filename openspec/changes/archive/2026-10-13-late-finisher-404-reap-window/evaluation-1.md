## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `d52f8185307c783dd27eeb3dcf78b71f4d256fb9`. Base `f3490d1d8c81a5082c973c21462ace3089d7183a`, resolved live by `resolve-review-base.sh` (main, origin).

### Phase 1: Spec Review — FAIL

Issues:

1. **AC1 and the spec scenario "Pipeline deleted while its run executes" are not met for one reachable window. I reproduced it; it is not just theoretical.**
   The early tri-state check (`PipelineRunExecutor.scala:358-363`) and the per-node guard only see a deleted pipeline if the deletion lands before the early check, or before a node's guard runs while the Output list is still populated. Two other windows exist:
   - **After the early check, before `outputRepo.listByPipelineInternal`.** This window includes `applyPendingWriteBacks` and runs up to `PipelineRunSucceededWrites.scala:87`. The FK cascade has already removed the Outputs, so `materializedNodeKeys` is empty and no guard ever runs. The eager `updateRun` (`:240`) loses because the row is gone, so `won = false`. `afterTerminalWin` skips silently, the chain yields `None`, `publishTerminalAfter` publishes `succeeded`, and the executor returns `Right(RunResultResponse(...))`.
   - **After the last node's guard, before `updateRun`.** Same outcome.

   **Probe (red).** I ran this in a throwaway detached worktree at the reviewed SHA, removed afterwards. The only change was to make `HookOutputRepo` (`LateFinisherRunSpec.scala:69`) delete *before* it lists:
   `- super.listByPipelineInternal(pipelineId).flatMap(outputs => hook().map(_ => outputs))`
   `+ hook().flatMap(_ => super.listByPipelineInternal(pipelineId))`
   Result: `should write nothing, publish no succeeded and answer 404 when its pipeline was deleted in that window *** FAILED *** Right(RunResultResponse(Vector({"label":"a",...}), 3, ..., Some("cbe2dca6-..."), ...)) was not equal to Left(NotFound("Pipeline not found: 67e8acdc-..."))`.

   The shipped test only passes because its hook lists the Outputs first. The test's own scaladoc says so: "listed first, so a pipeline deleted by the hook still has its stale Output list" (`:64`). So the test is built to avoid exactly this window.

   The spec delta's scenario has no qualifier ("WHEN a real run is admitted, its pipeline is deleted ..., and the execution then succeeds THEN it answers 404"). The design's Non-Goals list residual windows only for alerts, binary refs, the baseline and Output schemas, never for the response status. A 200 plus a `succeeded` event for a pipeline that no longer exists is also worse than the 409 the ticket set out to fix. This is a spec divergence, not an accepted residual.

2. **Task 4.1 (file the Linear follow-up) is still open.** It must be done before the PR, and its id goes in the PR body per tasks.md.

3. **Task 3.1 is ticked, but its stated verification (`grep -n -B2` on each call site) was not recorded.** The comments themselves are present, including the one the executor says is missing:
   - `OrphanedRunReaper.scala:25-27`
   - `PipelineRunExecutor.scala` `runState` (around `:391`)
   - the Missing-case `findByIdInternal` at `PipelineRunExecutor.scala:374-375` ("Privileged existence check (read-only), keyed by the id `submit` already authorized ...")
   - the guard at `PipelineRunSucceededWrites.scala:72-77` and `PipelineRunRepository.runGuardAction`'s scaladoc

   The executor's claim that the Missing-case `findByIdInternal` "has no own comment" is **incorrect**: it has one. Only the evidence for the tick is missing.

Passing:
- **Terminal case.** Still 409 with the unchanged text.
- **Missing case with the pipeline still present.** Returns 409 with the N3 neutral text.
- **N1, backfill.** Backfill is unguarded; `guard` defaults to `None`.
- **N4.** The publish comment was updated.
- **N5.** The guard trip is recovered in `onRunSuccess` (`recoverWith` on the Open branch), not in the engine-failure handling.
- **Scope.** No migration and no API shape change.
- **C1** (Standing Constraint) is honored: the guard accepts `status = 'succeeded'`, and a positive control exists and can be made to fail (see Phase 2).

### Phase 2: Code Review — FAIL (only because of Phase 1 item 1; the code otherwise passes)

**Gates, run fresh by me:**
- **`sbt testFull`** (HELIO_TEST_JVM_XMX=3g, `-J-Xmx3g`, nice -n 19). One invocation hits the 600 s tool timeout. It ran about 7,536 test cases across 464 of 475 suites before the kill. The only 3 `FAILED` lines were in `AlertEventRepositorySpec`, and they were `FATAL: terminating connection due to administrator command`, caused by the timeout shutting down embedded Postgres. There were 0 ABORTED. I then ran the 11 suites the run never reached plus `AlertEventRepositorySpec` with `testOnly`: `Tests: succeeded 185, failed 0`, `ScalaTest summary: failed=0 aborted=0`. Together the two runs cover every suite, green, but the suite was never run as one single invocation.
- **Targeted run** of `LateFinisherRunSpec`, `PipelineRunServiceTerminalOrderingSpec`, `LiveRunReaperSpec` and `OrphanedRunReaperSpec`: 31 passed, 0 failed.
- **`npm run check:scala-quality`:** clean. Soft warnings only, including the new `LateFinisherRunSpec.scala` at 311 lines against the 250 soft budget. That is not blocking.
- **`check-openspec-hygiene.mjs`:** clean.

**Mutation evidence, re-derived by me** in a throwaway worktree (removed afterwards). The executor's M1-M5 are not recorded in any artifact or in the commit message, so these results are mine:

| Mutation | Result |
|---|---|
| A: guard keyed on `completed_at IS NULL` alone (dropped `\|\| status == "succeeded"`) | Positive control (C1) FAILED; the other 7 passed |
| B: run row `FOR KEY SHARE` instead of `FOR SHARE` | "make a reap wait ..." FAILED |
| C: pipeline row lock removed (plain `SELECT`) | No-deadlock case FAILED with `PSQLException: ERROR: deadlock detected` (40P01). The design's lock-order rationale holds, and the test is not vacuous. |
| D: `guard = None` in the success chain | Both item-2 window cases (reap → 409, delete → 404) FAILED |

**Design premises checked:**
- **Privileges.** `pipelines` (V22) and `pipeline_runs` (V24) were created before V38, which runs `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_privileged` and also sets default privileges. No later migration revokes it; the only table-level revoke is on `audit_events` in V91. `FOR SHARE`/`FOR KEY SHARE` need UPDATE, so the grant is sufficient.
- **`succeeded` writers.** The only writers of `succeeded` on a run row are `PipelineRunSucceededWrites:241` (this chain) and `SparkJobSubmitter:96`. The Spark one belongs to a separate execution path for its own run id, not a concurrent writer for an in-process run, so the D3 premise holds.
- **`PipelineRunServiceTerminalOrderingSpec` "staged release" edit.** The HEL-1366 invariant is unchanged: no terminal event while either lock is held; the run is non-terminal and has 0 snapshots at stage 1; the table lock is shown to block at stage 2; at the moment the event is observed, both the status and the snapshots are durable; there is exactly one terminal event. The removed stage-1 `awaitBlockedBy(tableLock)` is correctly explained: the node transaction now waits at the guard's `FOR SHARE` on the held run row, before it reaches `node_snapshots`, and stage 2 still proves the table-lock block. The test is not weakened.

**Checklist items not covered above:**
- **Code quality.** Imports are top-level, there are no inline FQNs, and the ADT is small and sealed.
- **DRY.** The test reuses `NodePayloadFixtures`.
- **Type safety.** `skipPublishOn` defaults to always publishing, so other callers are unaffected.
- **Error handling.** A guard trip never reaches a 500.
- **Dead code.** `isRunOpenInternal` was removed with no remaining callers.

### Phase 3: UI Review — N/A
This change touches only backend code. None of `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changed; the only spec change is the change-local delta. The only client-visible effect is a status code (409 becomes 404).

### Overall: FAIL

### Change Requests

1. **Close the deleted-pipeline window after the early check** (Phase 1 item 1) in `backend/src/main/scala/com/helio/services/pipelines/PipelineRunSucceededWrites.scala`.
   - When `updateRun` resolves `won = false`, read `pipelineRunRepo.runStateInternal(runId)`. Do this only when `pipelineRunRepo != null`, since the fixture rule stays as it is.
   - If the state is `Missing`, fail the chain with `PipelineRunRepository.RunNoLongerOpen(RunState.Missing)`. `publishTerminalAfter` already skips the publish for that exception, and `PipelineRunExecutor`'s `recoverWith` already maps it to 404, or to 409 if the pipeline still exists.
   - This covers both the before-list window and the after-last-node window.
   - **Decision for you: the `Terminal` (reaped after the fold) case.** Either map it the same way, which is consistent with the spec's "Stalled instance finishes after its run was reaped → 409", or leave it as HEL-1511's accepted residual. If you leave it, say so explicitly in the spec delta and design.
2. **Add a red-first test** in `backend/src/test/scala/com/helio/services/pipelines/LateFinisherRunSpec.scala`: a variant whose hook deletes the pipeline **before** `listByPipelineInternal` returns (`hook().flatMap(_ => super.listByPipelineInternal(pipelineId))`). It must assert `Left(NotFound("Pipeline not found: <id>"))`, `nothingWritten`, and no `succeeded` event. Record its red output against the current code; I observed `Right(RunResultResponse(...))` (see above). Fix the existing hook's scaladoc (`:64`) so it no longer reads as covering the whole window.
3. **Do task 4.1**: file the Linear follow-up (Follow-up label, relatedTo HEL-1518) for the non-snapshot residual writes and N2 pruning, and record its id for the PR body. If you take the narrow option in CR1, note any remaining window in it as well.
4. **Record task 3.1's `grep -n -B2` output** for the four call sites as evidence, or reword the task to match what was actually verified. The comments themselves are fine.

### Non-blocking Suggestions
- Record mutation runs A-D (or the executor's own M1-M5) in an evidence file under the change dir, so the auditor/skeptic do not have to re-derive them.
- `LateFinisherRunSpec.scala` is 311 lines, over the 250-line soft budget. Consider splitting the D3 lock-behaviour cases into their own spec.
