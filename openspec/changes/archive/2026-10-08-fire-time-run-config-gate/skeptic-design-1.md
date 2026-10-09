## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `eda9ed491428c904ab9d486146ed65b47c003ba7` (branch has no commits yet; change dir untracked). Owner rulings Q1/Q2/Q3 taken as given.

### What I verified (with evidence)

- **Premise of gaps 1-3 holds on live code.** `PipelineSchedulerService.processAutoRunClaim` (l.130-137) -> `fireAutoRun` -> `submit(..., AutoRun)` with no re-check; `fire` (l.208-241) -> `submit(..., Scheduled)` with no config check. A write-time denial in `AutoRunTriggerService.evaluateAndSchedule` (l.331-363) never touches an existing debounce row. `submit` consumes the HEL-505 rate slot first (`PipelineRunExecutor.executeRun`, `incrementRateIfUnderLimit`), then inserts under the concurrency cap, then fails in the engine with `StepConfigError` (`InProcessPipelineEngine` l.263-272).
- **The shared check is schema-independent (HEL-1280).** `PipelineAnalyzeService.stepConfigProblem` = `validateStepConfig(op, rawConfig)` (l.52, l.344-397): `validateRawConfig` shape rejection, `requiredConfigProblems`, and per-kind enum validators. It reads only `(op, rawConfig)` and does no schema inference. Same function HEL-1279 (c26c3056) already gates auto-run with.
- **Fire-time cost re-evaluation can match write time.** `PipelineCostInputGathering.gather` takes no `dataSourceId`. In `evaluateAndSchedule`, `dataSourceId` is used only for logging and `handleDenied`, so a single private `computeVerdict(pipelineId)` (D2) is possible and gives the same verdict at write time and at fire time.
- **Q2 claim release is safe.** `releaseClaim` is a compare-and-delete on `claimed_at`, and `upsertDebounce` resets `claimed_at = NULL`, so a write that arrives during the fire-time evaluation survives.
- **RLS (prod non-BYPASSRLS `helio`), checked by reading code:**
  - Fire-time reads all run under `withSystemContext`: `findByIdInternal`, `listByPipelineInternal` (StepRepo l.346), `findLastRunRowCountInternal` (l.146), `listRootDataSourceIdsInternal` (l.130), `countDatasetRows` (DataSourceRepo l.191), `dataSourceRepo.findByIdInternal`.
  - `recordUnrunnable`'s writes:
    - `insertRun` runs the ownership SELECT under `withUserContext(owner)` and the INSERT through `insertRunInternal` under `withSystemContext`.
    - `updateRunTerminal` uses a user-context SELECT, then a system-context UPDATE.
    - `updateLastRun` uses user context, which every scheduled run already exercises in prod.
  - Sound. D7's wording ("same context as `insertRunIfUnderConcurrencyCap`") is slightly inaccurate, because that method inserts under user context. The real path is more permissive, not less (non-blocking note).
- **Nullable wiring (D6).** Today `autoRunDebounceRepo` and the guard repos default to `null` (scheduler l.34-49). D6 requires the step repository, and requires the trigger service together with `autoRunDebounceRepo` ("both or neither"). That closes the silent-off risk. I found 8 scheduler construction sites: Main.scala:293; the Fixture; UpsertSourceRlsSpec; MaintenanceHooksSpec x2; Coalescing, BurstProof, NoRetryStorm and EndToEnd specs. D6's "every other construction site" covers them; task 2.6 names only the fixture.
- **Red-first tests on main.** See CR3. In 1.1, every listed assertion except one also holds on main. The one that does not holds only vacuously in the current fixture.

### Verdict: REFUTE

### Change Requests

1. **D5 creates an endless retry loop when the evaluation failure is permanent rather than transient.** `PipelineStepRepository.listByPipelineInternal` -> `rowToDomain` (l.1317-1357) *throws* `IllegalStateException` for any stored step whose config fails to decode. That covers wrong-typed keys and the legacy rows HEL-814 says the stored-analyze surface "cannot read at all". It fails the same way on every attempt.
   - Today `fire` catches the resulting `submit` failure (l.231-236) and still advances `next_run_at`.
   - Under D3/D5 the step listing moves before `submit` and its failure propagates to `processCandidate`. The schedule then never advances and errors every tick, forever.
   - The auto-run claim is likewise never released and is reclaimed every 300s, forever.
   - Revise D5 to separate "no submit" (keep it fail-closed) from "no progress". Options:
     - (a) On evaluation failure, still advance the schedule and release the claim, without submitting. This is today's submit-failure behaviour.
     - (b) Treat an undecodable step as a step-config failure, so a scheduled fire records a failed run with the decode reason and an auto-run is skipped.
     - (c) Bound the retries explicitly.
   - Add a test for the permanent case (a step row whose stored config does not decode).
   - Update the spec scenario "Fire-time evaluation fails" in both deltas to match.
2. **The D3 record-failed-run path never prunes run history.** `recordUnrunnable` (PipelineRunService l.218-241) does insert -> terminal -> updateLastRun with no retention pass. The `submit` path prunes to 10 via `deleteOldRuns(pipelineId, user, keepN = 10)` (PipelineRunExecutor l.155).
   - Today `recordUnrunnable` is called once per proposal apply, so this did not matter. On a cron, a misconfigured pipeline firing every minute would add about 1,440 `pipeline_runs` rows a day without bound, where today the same pipeline stays at 10.
   - D3/D4 must call the same owner-scoped `deleteOldRuns(..., keepN = 10)` after the never-attempted insert on the scheduled path. A `recordUnrunnable` option is acceptable.
   - Task 1.1 (or a sibling test) must assert that the history stays capped across more than 10 fires.
3. **Red-first test 1.1 has no specified observable that is red on main.** On main the same scenario already does all of the following:
   - executes and fails with `StepConfigError`;
   - persists a failed run with `trigger_source = scheduled` and a step-config error;
   - sets last-run status `failed`;
   - advances `next_run_at`.

   "Rate-window count unchanged" is vacuous in `PipelineSchedulerServiceFixture`: its `PipelineRunService` (l.94-104) is built without a `PipelineRunGuardRepository`, so no rate-window row is ever written on either branch. "Assert no submit/execution" names no mechanism. Specify at least one assertion that fails on main. For example:
   - wire a real `PipelineRunGuardRepository` into the run service under test and assert the `pipeline_run_rate_window` count is unchanged (it increments on main);
   - assert the run's `error_log` carries the new D3 prefix, and not the engine's `StepExecutionException` text;
   - assert no `auditSubmit` audit event is written.

   Require that the red output be recorded for that assertion specifically, not for the test as a whole.

### Non-blocking notes

- D7: say precisely that `insertRun`'s INSERT runs in system context after an owner-context ownership check, rather than "same context as `insertRunIfUnderConcurrencyCap`". Note in the PR that `recordUnrunnable` fails silently in several ways: `insertRun` errors are swallowed by `.recoverWith`; an ownership `false` is a no-op; `updateRunTerminal` returning `None` is a no-op. A prod RLS denial would therefore leave no failed run and still advance the schedule. That is safe (no budget is spent) but invisible. Consider logging the outcome at INFO.
- 1.3: name how the cost verdict is flipped without a write. An AI or non-cheap step being enabled, or dataset rows pushed past `MaxAutoRunRows` with a direct insert, both work. Make sure that step does not itself trigger `triggerAutoRun`.
- Task 2.6 should list all 8 scheduler construction sites. The four auto-run specs must now pass the trigger service into the scheduler, or D6's `require` will fail them.
- `stepConfigProblem` is a superset of the engine's `requiredConfigProblems`: it adds `validateRawConfig` and the enum validators. Every added validator I read corresponds to a value the engine also rejects (HEL-1416 shared rules). A pipeline that would have run successfully is therefore not expected to be failed by the gate. A parity note in design would help.
