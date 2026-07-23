## Why

HEL-447 and HEL-455 built alert rule and event persistence, but nothing evaluates a rule
against real data yet. Rules and events are inert until a runtime compares row data to a
threshold and drives the event state machine. This change adds that evaluation engine and
wires it into the one place data is currently written: pipeline run completion.

## What Changes

- New `AlertEvaluationService.evaluateForDataType(dataTypeId, rows, triggeringRunId)`: the
  single entry point for both the run-completion hook (this ticket) and the future HEL-340
  scheduler.
- Loads enabled rules for a `DataTypeId` via `AlertRuleRepository.listEnabledByDataTypeInternal`,
  resolves each rule's `metric` against the in-memory row set (single-row scalar, or a
  column aggregate — `metric = "*"` is the row-count sentinel), evaluates the `gt|gte|lt|lte|
  eq|neq` threshold comparator, and drives `AlertEventRepository`'s privileged
  `upsertFiringInternal` (breach) / a new privileged resolve path (condition clears).
- `PipelineRunService.onRunSuccess` invokes evaluation after the row write, wrapped so an
  evaluation failure is logged and never fails or rolls back the run (mirrors the existing
  `recoverWith` discipline in that file).
- `AlertEventRepository` gains a privileged `resolveInternal` transition (auto-resolve the
  active firing event when a rule's condition no longer breaches), following the same
  `withSystemContext` + `AlertEventStateMachine.transition` pattern as `upsertFiringInternal`.
- Wires `AlertEventRepository` into `Main.scala`/`ApiRoutes` production startup — HEL-455 left
  `alertEventRepo` unconstructed there, so `/api/alerts` and this evaluation engine are both
  unreachable in production without this fix.

## Capabilities

### New Capabilities

- `alert-evaluation-engine`: rule-to-event evaluation runtime — metric extraction, threshold
  comparator evaluation, breach/clear-driven event transitions, run-completion + future
  scheduled-run entry point, evaluation-failure isolation.

### Modified Capabilities

- `alert-event-persistence`: adds a privileged `resolveInternal(ruleId)` transition to
  `AlertEventRepository`, alongside the existing `findActiveByRule`/`upsertFiringInternal` pair,
  for the evaluation engine's auto-resolve-on-clear path.

## Impact

- `backend/src/main/scala/com/helio/services/AlertEvaluationService.scala` (new).
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` (hook in `onRunSuccess`).
- `backend/src/main/scala/com/helio/infrastructure/AlertEventRepository.scala` (new privileged
  `resolveInternal` method).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala`, `backend/src/main/scala/com/helio/app/Main.scala`
  (wire `AlertEventRepository` + `AlertEvaluationService` into production startup).
- No schema change — V60/V61 (`alert_rules`/`alert_events`) already cover the persistence this
  ticket needs.

## Non-goals

- Delta/change, missing-data, and z-score/anomaly condition kinds (follow-on ticket).
- Alert delivery (HEL-432) and freshness/staleness evaluation (HEL-431).
- The HEL-340 scheduler itself — only its call-compatible entry point.
