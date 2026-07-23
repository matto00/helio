# HEL-466: Alert evaluation engine + run-completion & scheduled-run hooks

## Context

Greenfield alerting. Rules (HEL-447) and events (HEL-455) exist but nothing evaluates them. The natural evaluation hook is the moment a pipeline run finishes and writes its output DataType's rows: `PipelineRunService.onRunSuccess` in `backend/src/main/scala/com/helio/services/PipelineRunService.scala` (it already calls `dataTypeRowRepo.overwriteRows(...)` and `updateLastRun(...)`). Evaluating there means an alert reflects exactly the snapshot just written — the same rows `GET /api/types/:id/rows` serves.

This ticket builds the evaluation runtime and wires it into run completion (and the scheduled-run path once HEL-340 lands). It ships the baseline **threshold** comparator; richer condition kinds are a follow-on ticket.

## Batch context (predecessors merged to main)

- HEL-447 (PR #265, squash 76a1071d): `alert_rules` (V60), `AlertRuleId`/`Severity`/`Comparator`, `AlertRuleRepository` including the privileged `listEnabledByDataTypeInternal` built specifically for this engine ticket, `AlertRuleService`, `/api/alert-rules`.
- HEL-455 (PR #267, squash acf550a2): `AlertEvent` domain model, `AlertEventStateMachine.transition` (single source of truth; ReFire legal from every active state — firing/acknowledged/snoozed-unexpired/snoozed-expired — refreshing value/severity/lastEvaluatedAt), V61 `alert_events` (FK to alert_rules, owner RLS, `(alert_rule_id, state)` index), `AlertEventRepository` with privileged `findActiveByRule`/`upsertFiringInternal` dedup path, `AlertEventService`, `/api/alerts`.

## Scope

* `AlertEvaluationService` in `backend/src/main/scala/com/helio/services/`: given a `targetDataTypeId` and its freshly-written rows, load all enabled rules via the rule repo's privileged `listEnabledByDataTypeInternal` (no request user in this background path — same rationale as the existing `*Internal` upserts in `PipelineRunService`), evaluate each, and drive `AlertEventService`/event repo transitions (open/refresh a firing event on breach; auto-resolve the active event when the condition clears).
* Metric extraction: resolve `metric` against the row set — a single-row scalar, or an aggregate over the column (the `metric = *`/count sentinel from HEL-447). Reuse row JSON handling (`PipelineRowJson`); do not re-query — evaluate against the in-memory `resultRows`/`jsRows` already present in `onRunSuccess`.
* Baseline condition: threshold comparators `gt|gte|lt|lte|eq|neq` vs `threshold`. Numeric coercion consistent with `inferFieldType` in `PipelineRunService`.
* Hook into `onRunSuccess`: after `rowsUpsert`, fire evaluation as a non-blocking follow-up that never fails the run (recover + log, matching the existing `recoverWith` discipline in that file). Keep actor/execution paths non-blocking per CLAUDE.md.
* Scheduled-run integration point: expose a single `evaluateForDataType(dataTypeId, rows, triggeringRunId)` entry so the HEL-340 scheduler calls the identical path (relatedTo HEL-340). Guard with a clear seam if HEL-340 has not merged.
* Emit a domain event/log line per fired/resolved event so delivery (HEL-432) can subscribe later; no delivery in this ticket.

## Acceptance criteria

* After a real pipeline run whose output breaches a rule, exactly one active `AlertEvent` exists (HEL-455 dedup honored); a subsequent run that clears the condition transitions it to `resolved`.
* A run that fails (`onRunSuccess` not reached) creates no events; evaluation raising an exception logs and never fails or rolls back the run.
* Both single-row scalar and column-aggregate metrics evaluate correctly across all six comparators.
* Evaluation runs against the exact rows just written (no stale re-read).
* ScalaTest: breach → firing, clear → resolved, re-breach dedup, evaluation-error isolation, comparator matrix. `sbt test` green.

## Out of scope

* Delta/change, missing-data, and z-score/anomaly conditions (condition-types ticket).
* Delivery of events (HEL-432); freshness/staleness evaluation (HEL-431).
* The scheduler itself (HEL-340) — this ticket only exposes the entry point it will call.

## Dependencies

* Blocked by: alert rule model (HEL-447), alert event model + state machine (HEL-455).
* Related: HEL-340 (scheduled runs — second evaluation trigger), HEL-419 (a failed pipeline assertion should be able to raise an alert event through this same service).
