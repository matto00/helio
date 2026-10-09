## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `6a58b53094d53f475e3fbb901ba7ddc311db16a5`. The diff base was resolved live with `resolve-review-base.sh` as `eda9ed491428c904ab9d486146ed65b47c003ba7` (origin/main). The change is backend only: no `frontend/**` files, so there was no UI judgment to make.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/fire-time-run-config-gate/HEL-1384`.
- **Owner rulings:** `.concertino/runs/HEL-1384/events.jsonl` has an `escalation.answered` event with `sub_answers ["record-failed-run","skip-and-log","no"]`, `answer_source: human`.
- **I read the full main-source diff myself:** `RunConfigGate.scala` (new), `AutoRunTriggerService`, `PipelineSchedulerService`, `PipelineRunService.recordUnrunnable`, `Main.scala`, `ApiRoutes.scala`.

**AC trace**
- **AC1, where the gate lives and the user-visible decision.** There is one shared check, `RunConfigGate.stepConfigReasons`, used at write time (`AutoRunTriggerService.computeVerdict`), at auto-run fire time (`processAutoRunClaim` → `evaluateAtFire`) and at scheduled fire time (`gatedSubmit`). The user-visible choice was escalated and answered by the owner.
  - Q1, record-failed-run: `gatedSubmit` calls `recordUnrunnable(..., TriggerSource.Scheduled, pruneOldRuns = true)` and never `submit`. The schedule then advances in `fire`.
  - Q2, skip-and-log: the auto-run path logs at INFO, does not submit, and calls `releaseClaim`.
  - Q3, no cost gate on schedules: `gatedSubmit` applies only `RunConfigGate`, not `PipelineCostEstimator`.
- **Same verdict at fire time as at write time.** It is the same verdict, structurally. `evaluateAndSchedule` and `evaluateAtFire` both call the single private `computeVerdict(pipelineId)`. Main wires the scheduler with `apiRoutes.autoRunTriggerServiceOpt.orNull`, which is the same instance the write path uses, and both are built from the same `autoRunDebounceRepo` (Main.scala:150, 275, 301). The only intended difference is fresher state (row counts, step enablement), as design D2 and Risks say.
- **AC2, red-first.** I reproduced this myself; I did not rely on the evaluator's log.
  - Setup: I extracted `git archive eda9ed49 backend` into my scratchpad and copied in `FireTimeRunConfigGateSpec.scala` unchanged except the `newScheduler` constructor shim. I dropped the two new constructor arguments, which don't exist on main; that diff is 3 lines.
  - Result of `sbt testOnly ...FireTimeRunConfigGateSpec`: `Tests: succeeded 3, failed 7`. All 7 are assertion failures, none are compile errors (C1):
    - gap 2: `1 was not equal to 0` (rate window).
    - 1.1a: the engine's `StepExecutionException` text `did not start with substring "Step configuration invalid; scheduled run not attempted: "`.
    - gaps 1-config, 1-cost and 3: a failed `auto-run` run row is present.
    - both undecodable-config tests: `true was not equal to false` (main does submit).
- **AC3, HEL-1280 and HEL-1279.**
  - `RunConfigGate` calls only `PipelineAnalyzeService.stepConfigProblem(kind, rawConfig)`, which has no schema parameter, and only over `filter(_.enabled)`.
  - The negative control with `$missing_col` (schema-derived only) passes on both the schedule and the auto-run path (rate window 1 → 2).
  - HEL-1279 guards: `AutoRunTriggerServiceSpec`, `PipelineAnalyzeSchemaWarningsSpec` and `DataSourceServiceDeniedPipelinesSpec` are green in my run.
- **Gates I re-ran:** `sbt testOnly` over FireTimeRunConfigGateSpec, the 3 HEL-1279 guard specs, PipelineSchedulerService*, AutoRunGuard*, and DatasetWriteAutoRun*. Result: 10 suites, `Tests: succeeded 66, failed 0`, EXIT=0.
  - For the full suite I rely on the evaluator's pasted `sbt testFull` output: `succeeded 6395, failed 0, canceled 4`. It is unambiguous, and it was run on the same HEAD.
- **Guards (C2):**
  - The evaluator's mutation log covers 4 guards.
  - The 2.4a record-failure guard was not mutation-checked there, so I did it myself. I removed `gatedSubmit`'s `.transform` around `recordUnrunnable` in a scratch copy of HEAD, and exactly that test went red: `Some(2026-02-28T23:59:00Z) was not equal to Some(2026-03-01T00:30:00Z)` (line 443). So that guard can fail.
- **No submit on an evaluation error, and no retry every tick:**
  - Scheduled path: `gatedSubmit`'s `Failure` branch logs at ERROR and returns `Future.successful(())`. The `fire` → `updateAfterTickInternal(next, Some(now))` call always runs. The `Future.delegate` wrapper catches synchronous throws too.
  - Auto-run path: the `Failure` branch logs at ERROR, does not submit, and releases the claim.
  - The record-failure path also advances the schedule (2.4a).
  - Tests: the undecodable-config tests and the 2.4a test all pass.
- **Deleted-pipeline paths:**
  - Scheduled: `fire`'s `None` branch is unchanged (WARN plus `recomputeOnly`).
  - Auto-run: `evaluateAtFire` now runs before `fireAutoRun`'s not-found WARN. Reading `PipelineCostInputGathering.gather` and `PipelineCostEstimator.estimate`, a missing pipeline gives an empty root list, so the verdict denies with `no-roots`. That is logged at **INFO** ("denied at fire time"), not ERROR as the evaluator said. ERROR appears only if a DB read actually throws.
  - Either way: no submit, the claim is released, and the V110 FK cascade makes the case unreachable in practice. Harmless; not a regression.
- **Run-history trim and owner visibility (Q1):**
  - Spec 1.1 checks `status = failed`, `trigger_source = scheduled`, `pipelines.last_run_status = failed`, and an `error_log` starting with the fixed prefix and naming the step. That is the run-history and badge surface the owner sees.
  - 1.1a: 12 fires leave exactly 10 runs, and the newest is the recorded skip. `deleteOldRuns(keepN = 10)` is the same call `PipelineRunExecutor:155` makes.
- **RLS under the prod non-BYPASSRLS `helio` role.** I checked this by reading code, because the tests run as superuser.
  - Fire-time reads are all `*Internal` on `withSystemContext`: `listByPipelineInternal`, `findLastRunRowCountInternal`, `listRootDataSourceIdsInternal`, `dataSourceRepo.findByIdInternal`. These are the same calls the write-time trigger already makes in prod.
  - The new writes use `owner = AuthenticatedUser(pipeline.ownerId, System)`:
    - `insertRun`: `withUserContext(owner)` ownership check, then a system-context insert.
    - `deleteOldRuns`: same pattern.
    - `updateRunTerminal` and `updateLastRun`: same calls as `PipelineRunTerminalWrites:78/81` on the existing scheduled-submit failure path.
  - There is no new table, policy or query shape, and the principal is always the pipeline's own owner. A swallowed `insertRun` failure is now logged at WARN.
- **Wiring:** `pipelineStepRepo` is a required positional argument with a `require`. There is also `require((autoRunDebounceRepo == null) == (autoRunTriggerService == null))`. A grep finds 10 `new PipelineSchedulerService(` sites, and all of them compile and pass.

### Verdict: CONFIRM

### Non-blocking notes
- `FireTimeRunConfigGateSpec.scala:39-42, 386`: the two undecodable-config tests are labelled GUARD ("green on main"), but they are red on main (reproduced above). Relabel them as red-first.
- `PipelineSchedulerService.scala`, in `fire` just above `gatedSubmit(schedule, owner)`: the comment still says "this `recover`". That handling now lives in `gatedSubmit`'s transforms. The comment is stale.
- `FireTimeRunConfigGateSpec.scala:402-405`: the second tick at t0+60s is not due anyway (next is t0+30m), so "not re-attempted" really rests on the first-tick `nextRunAt` advance assertion. That assertion is enough on its own.
- Task 3.3: put the D7 RLS reasoning in the PR body. The `PipelineSchedulerService.scala` and `PipelineRunService.scala` size budgets should also be noted there, per CONTRIBUTING.
