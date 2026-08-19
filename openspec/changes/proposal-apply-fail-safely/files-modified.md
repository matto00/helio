## Files modified

- `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` — D1: `handleInlineCreated`
  no longer deletes the just-created `rest_api`/`sql` source on a schema-fetch failure; instead threads
  `fetchError` onto the new `ResolvedSource.fetchError` field. D2: `ResolvedSource` gains a `kind` field
  (populated at every resolution site); `createPipeline` now branches on
  `PipelineRunService.SparkUnsupportedKinds.contains(resolved.kind)` after `addSteps` succeeds — when true,
  skips `pipelineRunService.submit` entirely (never reaches the Spark-submission rejection / never rolls
  back) and calls the new `recordUnrunnable` instead, building a `blocked` `PipelineProposalApplyResponse`.
  Class-level and inline doc comments updated to describe the new (non-rollback) behavior for these two
  cases.
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — Adds
  `PipelineRunService.recordUnrunnable(pipelineId, reason, user): Future[RunResultResponse]` (mirrors
  `onBlockedRun`'s persistence pattern: best-effort `insertRun`, `updateRunTerminal("failed", ...)`,
  `pipelineRepo.updateLastRun("failed", ...)`), and a new companion `object PipelineRunService` holding
  `SparkUnsupportedKinds: Set[String] = Set(DataSourceKind.RestApi, DataSourceKind.Sql)` — single source of
  truth for the kind list `runPipeline`/`previewStep` already hardcode as `RestSource`/`SqlSource` pattern
  matches (those two match arms are unchanged).
- `backend/src/test/scala/com/helio/api/PipelineApplyProposalSpecBase.scala` — Adds
  `latestPipelineRun(pipelineId): Option[(String, Option[String])]`, a privileged-pool DB helper reading
  the most recent `pipeline_runs` row's `status`/`error_log` for a pipeline, used by the rollback spec to
  prove the blocked run is durably persisted (design.md D3), not just returned transiently in the response.
- `backend/src/test/scala/com/helio/api/PipelineApplyProposalRollbackSpec.scala` — Rewrites the two
  `rest_api`-rollback tests (healthy-fetch-but-unsupported-kind, and schema-fetch-failure) to assert
  `201 Created` + retained/incremented resource counts + a `blocked` run + a persisted `pipeline_runs` row,
  instead of the old full-rollback assertions. Adds new tests for: an inline `sql` source whose connection
  fails (`localhost:1`, deterministic connection-refused), and an existing-`sourceId` reference to a
  pre-existing healthy `rest_api` source (via a new `createRestSource` helper posting to `/api/sources`).
  The three genuinely-still-rollback tests (assert-blocked run, addStep failure, cross-tenant `sourceId`)
  are unchanged.
- `backend/src/test/scala/com/helio/services/PipelineRunServiceSpec.scala` — Adds a
  `PipelineRunService.recordUnrunnable` test confirming the returned `RunResultResponse` (`blocked`,
  `blockedReason`, `runId`) and its persisted side effects: the pipeline's `lastRunStatus` becomes
  `"failed"` and a matching `pipeline_runs` row exists.
