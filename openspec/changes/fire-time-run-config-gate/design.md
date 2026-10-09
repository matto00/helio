## Context

- Write time: `AutoRunTriggerService.evaluateAndSchedule` computes `PipelineCostEstimator.estimate(...)` plus HEL-1279 config reasons (`PipelineAnalyzeService.stepConfigProblem` over the enabled steps), then either upserts a `pipeline_auto_run_debounce` row or reports a denial. A denial does not touch an existing row.
- Fire time: `PipelineSchedulerService.processAutoRunClaim` → `fireAutoRun` → `PipelineRunService.submit(..., TriggerSource.AutoRun)` with no re-check. `PipelineSchedulerService.fire` → `submit(..., TriggerSource.Scheduled)` with no config check at all.
- `submit` on a misconfigured pipeline consumes a HEL-505 rate slot, inserts a run under the concurrency cap, executes, and fails with `StepConfigError` (`InProcessPipelineEngine.requiredConfigProblems`), visible in run history.
- `PipelineRunService.recordUnrunnable(pipelineId, reason, user)` already persists a "never attempted" failed run (insertRun → updateRunTerminal(failed, errorLog=reason) → updateLastRun(failed)) without executing or touching the guard. Its `insertRun` currently uses the repository default `triggerSource = "manual"`.
- Owner rulings (escalation answered 2026-10-09 via chat, recorded in events.jsonl): Q1 record-failed-run, Q2 skip-and-log, Q3 no cost gate for schedules.

## Goals / Non-Goals

**Goals:**
- One shared step-config check, evaluated at fire time, covering gaps 1, 2 and 3.
- Red-first tests for each gap.

**Non-Goals:**
- Cost-gating scheduled runs (Q3 = no).
- Schema-derived analyze errors (HEL-1280) never gate anything.
- Clearing debounce rows at write time on denial. The fire-time re-check already guarantees a denied pipeline's pending row cannot fire, and the claim release removes it. A second write-time delete would add a second gate site for no behavioural gain (the AC prefers one shared check at fire time).
- Any change to the write-response `deniedPipelines`/`canRun` contract or to manual/hook/BoundPanel submits.
- A user-visible surface for a skipped auto-run (Q2 = skip-and-log).

## Decisions

**D1. Shared config check.** Extract the HEL-1279 config-reason computation into one function (e.g. `RunConfigGate.stepConfigReasons(enabledSteps): Vector[PipelineCostEstimator.CostReason]` in `com.helio.services.pipelines`). It is the only definition of "misconfigured for gating" and is used by the write-time trigger, the auto-run fire-time re-check and the scheduled fire-time check. It calls only `PipelineAnalyzeService.stepConfigProblem(kind, PipelineStepConfigCodec.encode(step))` over ENABLED steps, never analyze's schema inference. A disabled misconfigured step never gates.

**D2. Auto-run fire-time re-check (Q2).** `AutoRunTriggerService` exposes a fire-time evaluation (e.g. `evaluateAtFire(pipelineId): Future[Vector[CostReason]]`, empty = allowed) that reuses exactly the same verdict computation as `evaluateAndSchedule` (one private `computeVerdict(pipelineId)` used by both; no duplicated cost or config logic). `PipelineSchedulerService.processAutoRunClaim` calls it after the existing active-run check and before `fireAutoRun`. If the verdict is denied, it logs at INFO with the pipeline id and `code: detail` reasons (same format as `handleDenied`), does NOT submit, and releases the claim via the existing compare-and-delete `releaseClaim`, so a write arriving mid-evaluation still survives. If the pipeline no longer exists, the existing "not found" handling applies.

**D3. Scheduled fire-time check (Q1).** In `PipelineSchedulerService.fire`, after the pipeline is found and before `submit`, list its steps (`pipelineStepRepo.listByPipelineInternal`) and apply D1. If there are any reasons, call `pipelineRunService.recordUnrunnable(pipelineId, reason, owner, triggerSource = TriggerSource.Scheduled, pruneOldRuns = true)`. The reason is a single string starting with the fixed prefix `RunConfigGate.ScheduledSkipPrefix` (e.g. `"Step configuration invalid; scheduled run not attempted: "`), followed by each misconfigured step's id and `stepConfigProblem` message. That prefix is what distinguishes this path from the engine's own `StepExecutionException` text on main. Do not call `submit`. Then advance the schedule exactly as the normal path does (`updateAfterTickInternal(nextRunAt = next, lastRunAt = Some(now))`). The reserve/release in-flight guard and `hasActiveRunInternal` overlap check are unchanged. No HEL-505 counter is touched, because `recordUnrunnable` never calls the guard. Log the skip at INFO.

**D3a. Run-history trimming on the record-failed path (skeptic design-1 #2).** `submit`'s real-run path trims history with `pipelineRunRepo.deleteOldRuns(pipelineId, user, keepN = 10)` (`PipelineRunExecutor`); `recordUnrunnable` does not. Without trimming, a misconfigured pipeline on a once-a-minute cron would add about 1,440 rows a day with no limit. `recordUnrunnable` gains `pruneOldRuns: Boolean = false`. When true, after the insert it calls the same `deleteOldRuns(keepN = 10)` with the same swallow-and-continue `recoverWith` as the executor. The scheduled path passes `true`; the existing `PipelineProposalService` caller is unchanged. `recordUnrunnable` also logs (WARN) a swallowed `insertRun` failure instead of dropping it silently, so a prod RLS or ownership miss leaves a trace.

**D4. `recordUnrunnable` trigger source.** Add `triggerSource: String = TriggerSource.Manual` and pass it to `insertRun`. Existing callers are unchanged.

**D5. Failure handling at fire time (never submit; bounded, never a retry loop) — revised per skeptic design-1 #1.** A fire-time evaluation that fails must never submit. It also must not retry forever: a stored step config that does not decode makes `listByPipelineInternal` → `rowToDomain` throw on every attempt, so "propagate and retry" would loop indefinitely. The failure handling therefore mirrors what each path already does today when `submit` itself fails:
- Schedule: on an evaluation failure, log at ERROR (pipeline id, schedule id, exception), do NOT submit, and advance the schedule with `updateAfterTickInternal(nextRunAt = next, lastRunAt = Some(now))`. That is exactly what `fire`'s existing `Failure` branch does today for a submit that throws (including today's undecodable-step case). The run is retried at the next scheduled time, never every tick.
- Auto-run: on an evaluation failure, log at ERROR, do NOT submit, and release the claim (compare-and-delete). That is exactly what `fireAutoRun`'s existing transform does today for a submit that throws. The next dataset write re-arms the debounce.
- A transient DB error therefore costs at most one scheduled occurrence or one debounced auto-run, logged at ERROR. Accepted, because both fail-open and unbounded retry are worse.

**D6. Wiring must not be silently off in production.** The scheduler gains the collaborators it needs (a `PipelineStepRepository` for D3, and the `AutoRunTriggerService` for D2). The D3 gate must not degrade to a no-op through a nullable default: make the step repository a required constructor argument, or `require` it whenever the scheduler fires schedules. The D2 gate is required whenever `autoRunDebounceRepo` is wired: `require` both or neither, so a debounce pass can never run ungated. `Main.scala` passes the same `AutoRunTriggerService` instance `ApiRoutes` builds (expose it), or constructs an equivalent one from the same repos. Update every construction site: `Main.scala`, `PipelineSchedulerServiceFixture`, `AutoRunGuardBurstProofSpec`, `AutoRunGuardNoRetryStormSpec`, `DatasetWriteAutoRunCoalescingSpec`, `DatasetWriteAutoRunEndToEndSpec`, `PipelineRunServiceUpsertSourceRlsSpec`, `PipelineSchedulerServiceMaintenanceHooksSpec` (re-grep `new PipelineSchedulerService` before finishing).

**D7. RLS reasoning (prod `helio` role, non-BYPASSRLS).** Fire-time reads are `pipelineRepo.findByIdInternal`, `pipelineStepRepo.listByPipelineInternal`, `findLastRunRowCountInternal` and `dataSourceRepo.findByIdInternal`, all on the privileged system context and already exercised by the write-time trigger and the scheduler in prod. The D3 writes (`insertRun`: an ownership check under the owner's user context, then the insert in the system context; `updateRunTerminal`/`updateLastRun`/`deleteOldRuns`) are the same repository calls, with the same owner principal, that every scheduled `submit` already makes in prod. No new table and no new policy. Local tests run as superuser and cannot prove this; the evaluator/skeptic must check it by reading the code, not by relying on a green suite.

## Risks / Trade-offs

- A transient evaluation error skips one scheduled occurrence or one debounced auto-run (see D5).
- `stepConfigProblem` (analyze) and the engine's `requiredConfigProblems` both evaluate the step kind's own required-config declaration over the same raw config (HEL-814 D3), so a pipeline the gate passes is not rejected by the engine for the same required-config reason. The gate is deliberately no wider than analyze's config class.
- The fire-time cost verdict can differ from the write-time verdict (row counts change after an intervening run). This is intended: fire time is the authoritative decision.
- The extra step listing per scheduled fire is one indexed query per due schedule, negligible next to a run.
