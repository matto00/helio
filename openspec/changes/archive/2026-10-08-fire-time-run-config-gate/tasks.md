## Standing Constraints

- [C1] A red-first run on main must fail on an ASSERTION, never on a compile error: when recording red, reference new symbols by their literal values (e.g. the skip-prefix string) or keep the test compilable against main.
- [C2] Tests that pass on main by design (1.5 negative controls, 1.6 fail-closed) are GUARDS, not red-first proofs: label them as guards and show each one failing against a deliberately broken variant (mutation), recorded in the evidence.

## 1. Tests (1.1-1.4 and 1.1a red-first on origin/main; 1.5-1.6 are guards per C2)

- [x] 1.1 Scheduler spec (gap 2): a schedule saved on a valid pipeline, then an enabled step made misconfigured (e.g. an empty required config), then a tick. The fixture MUST wire a real `PipelineRunGuardRepository` into the `PipelineRunService` under test. Assertions that are red on main:
  - the owner's `pipeline_run_rate_window` count is unchanged (on main the submit increments it);
  - the recorded failed run's `error_log` starts with `RunConfigGate.ScheduledSkipPrefix` (on main it carries the engine's `StepExecutionException` text);
  - no submit audit event is written.
  Also assert (green on both branches; kept as regression checks): `trigger_source = scheduled`, last-run status `failed`, `next_run_at` advanced. Record the red output from main.
- [x] 1.1a Run-history cap: a misconfigured scheduled pipeline fires 12+ times; assert at most 10 runs are retained (skeptic design-1 #2; red against a `recordUnrunnable` without pruning).
- [x] 1.2 Scheduler/auto-run spec: an allowed dataset write upserts a debounce row; an enabled step is made misconfigured; the row becomes due; a tick. Assert no run submitted, the debounce row is gone, and a denial log line (gap 1, config).
- [x] 1.3 Same as 1.2, but the cost verdict flips to denied before fire WITHOUT a dataset write (gap 1, cost). For example, raise the persisted last-run row count or the root source's size directly through a repository/SQL fixture so `PipelineCostEstimator` denies; state the flip mechanism in the test.
- [x] 1.4 An allowed write leaves a pending row; the pipeline is made misconfigured; a second write is denied at write time; a tick. Assert no run (gap 3).
- [x] 1.5 Negative controls: a schema-derived-only analyze error does not gate a schedule or an auto-run; a disabled misconfigured step does not gate; a valid pipeline still fires on both paths.
- [x] 1.6 Fire-time evaluation error, including the permanent case (a stored step config that does not decode): no submit on either path; the schedule advances to its next fire time (not retried every tick) and the auto-run claim is released. Assert a second tick does not re-attempt.

## 2. Implementation

- [x] 2.1 Extract the shared step-config reason function (design D1) and use it from `AutoRunTriggerService` write time (HEL-1279 behaviour unchanged).
- [x] 2.2 Add `AutoRunTriggerService` fire-time evaluation reusing a single private verdict computation (D2).
- [x] 2.3 Gate `PipelineSchedulerService.processAutoRunClaim` on it: skip-and-log plus releaseClaim on denial (D2, D5).
- [x] 2.4 Gate `PipelineSchedulerService.fire`: record-failed-run via `recordUnrunnable(..., TriggerSource.Scheduled)`, then advance the schedule (D3, D5).
- [x] 2.4a If `recordUnrunnable` itself fails inside `fire`, still advance the schedule (wrap it the way today's submit `Failure` branch is wrapped), so a record failure never causes a retry every tick; cover this in 1.6.
- [x] 2.5 Add `triggerSource` and `pruneOldRuns` parameters to `recordUnrunnable`, and a WARN on a swallowed insert failure (D3a, D4).
- [x] 2.6 Wiring: required collaborators/`require`s in the scheduler, Main.scala/ApiRoutes, and all 8 construction sites listed in D6.

## 3. Verification

- [x] 3.1 All tests from section 1 are green; the HEL-1279 guard tests (`AutoRunTriggerServiceSpec`, `PipelineAnalyzeSchemaWarningsSpec`, `DataSourceServiceDeniedPipelinesSpec`) and the existing scheduler/auto-run specs are green.
- [x] 3.2 `sbt testFull` (or the targeted suites plus the full suite per the gate policy), backend lint/quality gates.
- [x] 3.3 Document the RLS reasoning (design D7) in the PR body.
