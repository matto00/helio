# Files Modified — assertion-fail-policy (HEL-570)

- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — core fail-policy: `onRunSuccess`
  now computes `blockingFailures` first and branches into `onBlockedRun` (terminal status `"failed"`,
  `errorLog` from the new `summarizeBlockingFailures` helper, only `updateMeta`/`updateRun`/
  `assertionsInsert` run, schema/rows/binary-refs/alert-evaluation skipped) vs. the unchanged
  `onUnblockedRunSuccess` path. Return type changed `Future[Unit]` → `Future[Option[String]]`
  (`None`/`Some(summary)`) so `executeRun` can populate `RunResultResponse.blocked`/`blockedReason`
  without recomputing the summary; `onDryRunSuccess` wrapped `.map(_ => None)` (dry runs exempt).
- `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala` — `RunResultResponse` gains
  `blocked: Boolean = false` / `blockedReason: Option[String] = None`; `runResultResponseFormat` bumped
  `jsonFormat5` → `jsonFormat7`.
- `backend/src/main/scala/com/helio/services/BoundPanelService.scala` — `runPipeline` gains a
  `case Right(r) if r.blocked =>` guard before the existing `case Right(_) =>`, reusing the existing
  `cleanup(...)` compensating-transaction path and returning a `"run"`-stage `UnprocessableEntity`.
- `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` — the `submit(...)` dispatch
  inside `apply`'s pipeline-creation chain gains the equivalent `case Right(runResult) if runResult.blocked =>`
  guard, reusing the existing `rollbackAll(...)` path.
- `backend/src/main/scala/com/helio/services/HookTriggerService.scala` — `submitNewRun` now reports
  `status = if (result.blocked) "failed" else "succeeded"` (no rollback — a hook-triggered run always
  re-runs an existing pipeline); stale inline comment asserting `"succeeded"` was the only possible
  `Right`-result status corrected.
- `schemas/hook-run-response.schema.json` — top-level `description` updated to describe the new
  `"failed"` status value for a blocked hook-triggered run.
- `backend/src/test/scala/com/helio/services/PipelineRunServiceSpec.scala` — new `"PipelineRunService.onRunSuccess
  (HEL-570 assert fail-policy)"` block: blocked run preserves prior DataType schema/rows, warn-only run
  updates normally, blocked run's terminal status/errorLog, all assertion results persisted for a blocked
  run, dry run exempt from the policy.
- `backend/src/test/scala/com/helio/api/routes/BoundPanelRoutesSpec.scala` — new test: a run blocked by
  an error-severity assertion cleans up the pipeline and inline source (`"run"`-stage 422).
- `backend/src/test/scala/com/helio/api/PipelineApplyProposalRollbackSpec.scala` — new test: a blocked
  run rolls back the pipeline/output type/inline source, same as a run failure.
- `backend/src/test/scala/com/helio/api/routes/HookRoutesSpec.scala` — new test: `POST /api/hooks/run`
  reports `status: "failed"` (not `"succeeded"`) for a run blocked by an error-severity assertion, and
  the failure is discoverable via run-history's `errorLog`.
