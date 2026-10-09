## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `6a58b53094d53f475e3fbb901ba7ddc311db16a5` (HEL-1384), diff base `eda9ed491428c904ab9d486146ed65b47c003ba7` (resolved live via `resolve-review-base.sh`).
Backend-only: `git diff --name-only` shows 0 `frontend/**` files.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- Ticket ACs: (a) the gate placement decision is recorded in design.md D1–D3. A single shared check, `RunConfigGate.stepConfigReasons`, runs at fire time on both paths and is reused at write time. The user-visible choice was escalated, and the owner rulings Q1/Q2/Q3 are recorded in workflow-state and events.jsonl. (b) Each fixed gap has red-first tests (checked below). (c) Only `PipelineAnalyzeService.stepConfigProblem(op, rawConfig)` gates. Its signature takes no schema, so it cannot gate on a HEL-1280 schema-derived error. The HEL-1279 guard specs are green.
- Owner rulings are honoured in the code:
  - Q1, record-failed-run. `gatedSubmit` calls `recordUnrunnable(..., TriggerSource.Scheduled, pruneOldRuns = true)`. It never calls `submit`, so the HEL-505 guard is untouched, and the schedule advance always runs.
  - Q2, skip-and-log. `processAutoRunClaim` logs at INFO and calls `releaseClaim`.
  - Q3, no cost gate on schedules. `gatedSubmit` applies only `RunConfigGate`.
- Every task in tasks.md is checked and matches the diff. Task 3.3 (RLS reasoning in the PR body) is still to do at PR time. The reasoning itself is in design D7.
- No scope creep. The only changes outside the gate are the `ApiRoutes.autoRunTriggerServiceOpt` visibility change (needed for D6) and the 6 construction-site updates.
- Constraints C1 and C2 are honoured. See Phase 2 (1) and (2).

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates. I ran these myself; none of the executor's reports were reused.**
- `cd backend && sbt testFull` in WORKTREE_PATH: `Tests: succeeded 6395, failed 0, canceled 4` (EXIT=0). The 4 cancels are the existing report-only/perf tests gated on `HELIO_MEASURE`. All 10 `FireTimeRunConfigGateSpec` tests ran and passed. Every other spec that should have run did run and pass: `AutoRunTriggerServiceSpec`, `PipelineAnalyzeSchemaWarningsSpec` and `DataSourceServiceDeniedPipelinesSpec` (the HEL-1279 guards), all `PipelineSchedulerService*` specs, `AutoRunGuardBurstProofSpec`, `AutoRunGuardNoRetryStormSpec`, `DatasetWriteAutoRunCoalescingSpec`, `DatasetWriteAutoRunEndToEndSpec` and `PipelineRunServiceUpsertSourceRlsSpec`.
- `npm run check:scala-quality`: clean. There are no inline FQNs; the size items are soft warnings only.

**(1) Red-first on main (C1). Verified independently.** I made a throwaway detached worktree at `eda9ed49` (main) and copied in the new spec unchanged except for one helper. `newScheduler` needed a constructor shim: I dropped the `pipelineStepRepo` and `autoRunTriggerService` arguments, which do not exist on main. This adaptation cannot be avoided because the new constructor arguments are the change itself. Everything else, including the skip prefix, is written as literals, as C1 requires. Result: 7 failed, 3 passed, and **every failure is an assertion failure, not a compile error**:
- 1.1 gap 2: `1 was not equal to 0` (rate-window count, line 240).
- 1.1a: the newest run's error_log, `"Pipeline execution failed at step ... missing required config value 'column'." did not start with` the prefix.
- 1.2 / 1.3 / 1.4 (gaps 1-config, 1-cost, 3): `runs(s) shouldBe empty` fails with a failed auto-run row present.
- 1.6 undecodable config, both paths: `true was not equal to false` (submit attempted).

Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1384/evidence/eval1-red-on-main-FireTimeRunConfigGateSpec.log`

**(2) Guards labelled, and spot-checked by mutation (C2). Verified.** In a throwaway worktree at `6a58b530` I applied 4 mutations: `pruneOldRuns = false`; `RunConfigGate` without `.filter(_.enabled)`; auto-run evaluation `Failure` → `fireAutoRun` (fail-open); scheduled evaluation `Failure` → `submit` (fail-open). Exactly the 4 matching tests went red:
- `12 was not less than or equal to 10` (1.1a cap).
- `Vector("failed") was not equal to Vector("succeeded")` (disabled-step negative control).
- `true was not equal to false` ×2 (both undecodable-config tests).

The other 6 stayed green. Evidence, including the mutation diff: `/home/matt/Development/helio/.concertino/runs/HEL-1384/evidence/eval1-guard-mutations-FireTimeRunConfigGateSpec.log`

Labelling: the spec header and the `(GUARD)` describe-blocks label the negative controls, the evaluation-error tests and the 1.1a prune assertion as guards. One inaccuracy, which does not block: the two "undecodable step config" tests are labelled GUARD ("green on main by design"), but my main run shows both are **red on main**, because main does submit. They are stronger than claimed. Only the label is wrong.

Not mutation-checked by me: the HEL-1280 schema-derived negative control. No small, natural mutation makes the gate schema-dependent, because `stepConfigProblem` takes no schema by type. I relied on code reading for this one. Under the 4 mutations the 2.4a record-failure guard stayed green, which is expected since none of them targeted it.

**(3) Is the 1.1a red claim acceptable? Yes.** My main run confirms the executor's description. On main the `rs.size should be <= 10` and `shouldBe 10` assertions passed, because main's submit path already trims via `PipelineRunExecutor`'s `deleteOldRuns(keepN = 10)`. The test failed only on the skip-prefix assertion. Being red against main on the cap is impossible in principle: the unbounded-growth risk exists only on the new `recordUnrunnable` path, which main never takes for schedules. Tasks.md itself defines 1.1a's red as "against a recordUnrunnable without pruning", which is a mutation. My M1 mutation (`pruneOldRuns = false`) turns it red with `12 was not less than or equal to 10`. So the cap is properly proven by a labelled guard plus a mutation, and the prefix assertion repeats 1.1's red. Acceptable.

**(4) Covered under gates above.** The HEL-1279 guards and the existing scheduler and auto-run specs are all green in `testFull`.

**(5) Wiring: no silent-off in prod. Verified.**
- `Main.scala:293-306` passes `pipelineStepRepo` positionally and `autoRunTriggerService = apiRoutes.autoRunTriggerServiceOpt.orNull`.
- Main passes the same `autoRunDebounceRepo` to `ApiRoutes` (`Main.scala:275`), so `autoRunTriggerServiceOpt` is `Some` and is the same instance the write path uses.
- `PipelineSchedulerService` has `require(pipelineStepRepo != null)` and `require((autoRunDebounceRepo == null) == (autoRunTriggerService == null))`. If the wiring is ever mismatched, boot fails loudly instead of running ungated.
- `pipelineStepRepo` is a required positional parameter with no default.

**(6) RLS under the prod non-BYPASSRLS `helio` role. Checked by code reading; dev and CI run as superuser, so tests cannot prove this.**
- Fire-time reads (`pipelineRepo.findByIdInternal`, `pipelineStepRepo.listByPipelineInternal`, `findLastRunRowCountInternal`, `costInputGathering.gather(resolveRoot = dataSourceRepo.findByIdInternal)`) all go through `ctx.withSystemContext`. That is the privileged pool (`helio_privileged`, BYPASSRLS, `DbContext.scala:53-64`) and the same pool the write-time trigger and scheduler already use.
- The new scheduled-skip writes all use `owner = AuthenticatedUser(pipeline.ownerId, AuditSource.System)`, the same principal a scheduled `submit` already uses:
  - `insertRun`: ownership check under `withUserContext(owner)`, then `insertRunInternal` on the system pool. This is the existing `recordUnrunnable` path already used in prod by `PipelineProposalService`.
  - `deleteOldRuns(owner)` is the same call `PipelineRunExecutor:155` makes.
  - `updateRunTerminal(owner)` resolves the owned run under the user context, then updates on the system pool. It is the same call `PipelineRunTerminalWrites:78` makes.
  - `updateLastRun(owner)` runs under the user context with an `owner_id` filter, the same call `PipelineRunTerminalWrites:81` makes.
- There is no new table, policy or query shape. The owner is the pipeline's own `owner_id`, so the owned-pipeline check cannot fail.
- A swallowed `insertRun` failure is now logged at WARN (D3a), so a prod miss leaves a trace.

**(7) HEL-1280: only the schema-independent check gates. Verified.**
- `RunConfigGate.stepConfigReasons` calls only `PipelineAnalyzeService.stepConfigProblem(op: String, rawConfig: String)` (`PipelineAnalyzeService.scala:52`, which delegates to `validateStepConfig`) over enabled steps. No schema is reachable from there.
- The write-time trigger now uses the same function, so HEL-1279 behaviour is unchanged. Its guard specs are green.
- The schema-derived negative control (`$missing_col`) passes on both paths.

**Other checklist items**
- DRY: one `computeVerdict` serves both `evaluateAndSchedule` and `evaluateAtFire`, and one `RunConfigGate` serves all three sites.
- Error handling: both evaluation-failure paths fail closed and are bounded (D5). The record-failure path still advances the schedule (2.4a).
- No dead code, no TODO or FIXME, and `ServiceError` is still used (`PipelineSchedulerService.scala:180`).
- Type safety is fine.

### Phase 3: UI Review — N/A
None of the Phase 3 trigger paths changed (`frontend/**`, `ApiRoutes.scala` routes, `schemas/**`, `openspec/specs/**`). The `ApiRoutes.scala` diff is a single visibility change (`private val` → `val autoRunTriggerServiceOpt`) and adds no route. The spec deltas live under `openspec/changes/`, not `openspec/specs/`. No API, schema or frontend change.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `FireTimeRunConfigGateSpec.scala`: the "fire-time evaluation error (GUARD)" block and the header say the two undecodable-config tests are green on main. They are red on main (see the red log). Relabel them as red-first, and keep the 2.4a record-failure test as the one real guard in that block.
- `PipelineSchedulerService.scala` (the `fire` method's comment just above `gatedSubmit(schedule, owner)`): the comment still describes "this `recover`", but that handling has moved into `gatedSubmit`'s `transform`. Update or drop the stale sentence.
- File size: `PipelineSchedulerService.scala` grows to 314 lines (over the ~250 soft budget). `PipelineRunService.scala` is 652 lines (already over 400 before this change; +18 here). CONTRIBUTING.md asks for a split to be proposed in the PR description once a file crosses ~400.
- `processAutoRunClaim`: for a deleted pipeline, `evaluateAtFire` now runs before `fireAutoRun`'s existing "not found" WARN. Any failure there is logged at ERROR. This is harmless (no submit, the claim is released), but the log level is noisier than before.
- PR body: include the D7 RLS reasoning (task 3.3).
