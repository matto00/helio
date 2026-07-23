- `backend/src/main/scala/com/helio/services/AlertEvaluationService.scala` — new: the alert
  evaluation runtime (`evaluateForDataType` entry point, `numericValue` coercion helper,
  metric extraction, threshold comparator evaluation, per-rule failure isolation, structured
  fired/resolved log lines).
- `backend/src/main/scala/com/helio/infrastructure/AlertEventRepository.scala` — adds the
  privileged `resolveInternal(ruleId)` method (Firing/Acknowledged → `Resolve` transition;
  Snoozed → explicit no-op; no active event → no-op).
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — adds a nullable
  `alertEvaluationService` constructor param and wires the post-`rowsUpsert` evaluation hook
  into `onRunSuccess`, wrapped in `recoverWith` so an evaluation failure never fails the run.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — builds `alertEvaluationServiceOpt`
  from `alertRuleRepo` + `alertEventRepo` (both present) and passes `.orNull` into the
  `PipelineRunService` constructor call.
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs `alertEventRepo` (the
  pre-existing HEL-455 gap that left `/api/alerts` unreachable in production) and passes it
  into `ApiRoutes`.
- `backend/src/test/scala/com/helio/services/AlertEvaluationServiceSpec.scala` — new: pure-
  function coverage for `numericValue`/`extractMetric`/`breaches` (comparator matrix, count
  sentinel, numeric-looking-string-not-coerced in both scalar and aggregate paths) plus
  embedded-Postgres integration coverage for `evaluateForDataType` (breach→firing, dedup,
  clear→resolve, no-op paths, disabled-rule skip, per-rule error isolation).
- `backend/src/test/scala/com/helio/infrastructure/AlertEventRepositorySpec.scala` — adds
  `resolveInternal` coverage (firing resolves, acknowledged resolves, snoozed left untouched,
  no active event no-op).
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` — adds
  `onRunSuccess`-level coverage: a failed run creates no events, a successful run invokes
  evaluation and fires a breaching rule, and an `AlertEvaluationService` failure (via a
  failing `AlertRuleRepository`, since the service class is `final`) does not fail the run or
  its recorded status.
