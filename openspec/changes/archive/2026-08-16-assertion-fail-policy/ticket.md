# HEL-570: Assertion fail policy — warn vs block DataType update

## Description

419-B (HEL-509) records assertion pass/fail per run but does not change run behaviour. This ticket adds the FAIL POLICY: an `error`-severity assertion failure blocks the DataType update (so bad data never reaches bound panels/metrics), while a `warn`-severity failure is recorded and the run proceeds. This is what makes an "alive" agentic dashboard trustworthy.

The write path is `PipelineRunService.onRunSuccess` (`backend/src/main/scala/com/helio/services/PipelineRunService.scala`): it upserts the output DataType schema + rows (`upsertFieldsFromRows`, `dataTypeRowRepo.overwriteRows`) and marks the run succeeded. Assertion results come from 419-B.

## Scope

* Policy evaluation: after step execution, inspect the run's assertion results (from 419-B). If any `error`-severity assertion failed, treat the run as BLOCKED: skip the DataType schema/row overwrite in `onRunSuccess`, mark the run terminal status accordingly (e.g. `failed` with an assertion-failure error log, or a distinct `blocked`/`assertion_failed` status if the design doc introduces one — extend the `pipeline_runs.status` CHECK via a Flyway migration ONLY if a new status value is chosen: next available VNN, assigned at scheduling time, main at V59, do NOT hardcode), and publish the corresponding SSE event. `warn`-severity failures never block.
* Preserve last-good data: a blocked run must NOT overwrite the existing DataType rows — the previously-good snapshot remains bound-panel-visible.
* Surface the outcome in the run record's `errorLog`/summary so run-history (419-D) can explain WHY a run was blocked, keeping the HEL-311 generic-client-error discipline (log detail server-side).
* No FQNs inlined in Scala.

## Acceptance criteria

- [ ] A run with a failing `error`-severity assertion does NOT overwrite the output DataType rows/schema; the prior snapshot is preserved (ScalaTest).
- [ ] A run with only `warn`-severity failures completes normally and DOES update the DataType, with the warnings still recorded per 419-B.
- [ ] The blocked run's terminal status + error summary make the assertion failure discoverable via run-history.
- [ ] If a new `pipeline_runs.status` value is introduced, its CHECK constraint is extended via Flyway (drop/re-add pattern) with no existing status removed; otherwise no migration.
- [ ] `sbt test` passes; no FQNs inlined.

## Out of scope

* Raising an external alert on failure (Alert Rules & Threshold Engine, HEL-430 — a failed assertion is a natural alert trigger).
* Run-history / panel badge UI (419-D).

## Dependencies

* Blocked by 419-B (HEL-509) — now merged. Relates to Alert Rules & Threshold Engine (HEL-430).
