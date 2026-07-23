## 1. Backend — persistence

- [x] 1.1 Add `AlertEventRepository.resolveInternal(ruleId: AlertRuleId): Future[Option[AlertEvent]]`
      (`withSystemContext`, `findActiveByRule` read). Branch on the active event's state: `firing`/
      `acknowledged` → `AlertEventStateMachine.transition(existing, AlertEventAction.Resolve)`,
      persist via the existing private `updateAction`, return `Some(resolved)`. `snoozed` → do NOT
      call `transition` (illegal from `Snoozed`); leave the row unmodified, return `None`. No
      active event → return `None`, no write.

## 2. Backend — evaluation service

- [x] 2.1 Create `AlertEvaluationService` in `backend/src/main/scala/com/helio/services/`
      constructed with `AlertRuleRepository` + `AlertEventRepository`.
- [x] 2.2 Add a dedicated `numericValue(v: Any): Option[Double]` coercion helper consistent with
      `inferFieldType` (`Int`/`Long`/`Float`/`Double`/`BigDecimal` → `Some`; every `String`
      (numeric-looking or not), `Boolean`, `null`, and nested values → `None` — deliberately NOT
      `PipelineRowJson.toDouble`, which would parse numeric-looking strings). Implement metric
      extraction on top of it: `"*"` count sentinel (any row count including zero), single-row
      scalar via `numericValue`, multi-row sum-aggregate via `numericValue` (skip `None`s),
      zero-rows-non-count-metric → skip rule.
- [x] 2.3 Implement threshold comparator evaluation (`gt|gte|lt|lte|eq|neq`) against
      `condition.threshold`, reusing `Comparator.fromString`.
- [x] 2.4 Implement `evaluateForDataType(dataTypeId, rows, triggeringRunId)`: load enabled rules
      via `listEnabledByDataTypeInternal`, evaluate each rule inside its own
      `Future`/`recover { case NonFatal(e) => log + () }`, `Future.sequence` them.
- [x] 2.5 On breach: call `upsertFiringInternal`; on successfully-extracted non-breach with an
      active event: call `resolveInternal`; on skipped extraction: no-op.
- [x] 2.6 Emit a structured `log.info` line per fired/resolved event (rule id, event id, state,
      severity, dataTypeId, triggeringRunId).

## 3. Backend — run-completion hook + wiring

- [x] 3.1 Add nullable `alertEvaluationService: AlertEvaluationService = null` param to
      `PipelineRunService`; in `onRunSuccess`, after `rowsUpsert`, call
      `evaluateForDataType(outputDataTypeId, resultRows, Some(runId.value))` wrapped in
      `recoverWith { case _ => Future.successful(()) }` (skip entirely when null, mirroring
      `binaryRefRepo`'s null-checked pattern).
- [x] 3.2 In `ApiRoutes`, build `alertEvaluationServiceOpt` from `alertRuleRepo`+`alertEventRepo`
      (both present) and pass `.orNull` into the `PipelineRunService` constructor call.
- [x] 3.3 In `Main.scala`, construct `val alertEventRepo = new AlertEventRepository(ctx)` and pass
      `alertEventRepo = alertEventRepo` into `ApiRoutes` (fixes the pre-existing HEL-455 gap that
      left `/api/alerts` unreachable in production).

## 4. Tests

- [x] 4.1 `AlertEventRepositorySpec`: `resolveInternal` — active firing resolves, active
      acknowledged resolves, active snoozed is left untouched and returns `None` (no illegal
      transition attempted), no active event is a no-op.
- [x] 4.2 `AlertEvaluationServiceSpec`: metric extraction (count sentinel incl. zero rows,
      single-row scalar, multi-row sum-aggregate with a non-numeric-typed value skipped, a
      numeric-looking `String` skipped/not-coerced in both the single-row scalar and multi-row
      aggregate paths, zero-rows non-count metric skips the rule).
- [x] 4.3 `AlertEvaluationServiceSpec`: comparator matrix (all six comparators) across scalar and
      aggregate metrics.
- [x] 4.4 `AlertEvaluationServiceSpec`: breach with no active event creates a firing event; breach
      with an active event dedups (no duplicate, refreshed); clearing an active firing event
      auto-resolves it; no breach with no active event is a no-op.
- [x] 4.5 `AlertEvaluationServiceSpec`: one rule's evaluation exception is logged and does not
      block a sibling rule's evaluation for the same `DataTypeId`.
- [x] 4.6 `PipelineRunService`-level test (new or existing spec covering `onRunSuccess`): a failed
      run creates no events; a successful run invokes evaluation; an `AlertEvaluationService`
      throwing/failing does not fail `onRunSuccess`'s `Future` or the recorded run status.
- [x] 4.7 Run `sbt test` and confirm the full suite is green.
