# HEL-509: Assertion evaluation + per-run results persistence

## Description

419-A (HEL-454) adds the `assert` step as an identity pass-through with a rule model but no evaluation. This ticket makes assertions MEAN something: on each run, every `assert` step's rules are evaluated against the rows flowing through it and the outcome is recorded per run, so a run's trustworthiness is inspectable after the fact.

Run lifecycle lives in `backend/src/main/scala/com/helio/services/PipelineRunService.scala` (`executeRun` → `onRunSuccess`/failure). Runs persist via `PipelineRunRepository` into `pipeline_runs` (`V24__pipeline_runs.sql`). The engine is `InProcessPipelineEngine` with `executeWithStepCounts`.

## Scope

* Evaluation: implement rule evaluation for the v1 rule kinds (`notNull`, `unique`, `range`, `rowCountMin`, `rowCountMax`, `regex`) over the rows AT the assert step's position. Prefer implementing it inside `AssertStep.evaluate` (it can compute pass/fail and surface results via the execution path) OR a dedicated evaluator invoked by the engine — choose the approach that keeps `PipelineStep.evaluate`'s pure row-in/row-out contract intact; if results must be threaded out, extend `PipelineExecutionContext`/the engine result rather than mutating rows. Each rule yields `AssertionResult(stepId, kind, field, severity, passed: Boolean, observed: Option[String], message: Option[String])`.
* Persistence: Flyway migration (next available VNN, assigned at scheduling time — main at V59; do NOT hardcode) creating `pipeline_run_assertions` (FK `run_id` → `pipeline_runs(id) ON DELETE CASCADE`, columns for step id, kind, field, severity, passed, observed, message) — mirror the `pipeline_runs` RLS/ownership approach (grantees read via the internal/system-context path, as `PipelineRunService.history` already does). Alternatively a single `assertions JSONB` column on `pipeline_runs` if the design doc justifies it; a child table is preferred for queryability.
* Wiring: `PipelineRunService` records assertion results as part of the run-completion transaction (both succeeded and — where evaluated — failed runs). Extend `PipelineRunRepository` with `insertAssertions`/`listAssertionsByRun`.
* No FQNs inlined; no blocking-behaviour yet (fail policy is 419-C — this ticket only RECORDS pass/fail).

## Acceptance criteria

- [ ] After a run of a pipeline containing an `assert` step, each rule's pass/fail is persisted in `pipeline_run_assertions` linked to that run.
- [ ] All six v1 rule kinds evaluate correctly, proven by ScalaTests (e.g. a `notNull` rule fails when the field has a null; `rowCountMin` fails when the row count is below the threshold; `unique` fails on a duplicate).
- [ ] Assertion results are readable per run via a repository method, RLS-safe for owner + grantees (parity with `PipelineRunService.history`).
- [ ] `PipelineStep.evaluate`'s row-in/row-out contract is not broken (results are threaded via the engine/context, not smuggled into row data).
- [ ] Migration added; `sbt test` passes; no FQNs inlined.

## Out of scope

* Blocking the run / skipping the DataType update on failure (419-C).
* Surfacing results in Run History UI or on panels (419-D).
* MCP/agent surface (419-F).

## Dependencies

* Blocked by 419-A (HEL-454) — now merged. Relates to Scheduled Runs (HEL-340). Downstream: 419-C/D/F.
