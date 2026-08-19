## Why

Applying a pipeline/combined proposal with a `rest_api`/`sql` source currently always destroys
everything it just created and returns an opaque error: a source-creation-time fetch failure
(`fetchError`) is treated as "delete the source and abort", and even a perfectly healthy `rest_api`/
`sql` source still gets rolled back at the eager first-run step, because the run engine only supports
`static`/`csv` today. Per explicit product direction, apply should fail safely — create what it safely
can and leave the pipeline/source visibly needing attention, not a dead end with an opaque `502`.

## What Changes

- `PipelineProposalService.handleInlineCreated` no longer deletes the just-created source and aborts
  the whole apply when the connector's schema fetch fails (`fetchError`) — it proceeds, keeping the
  source, and threads the error forward.
- `PipelineProposalService.createPipeline` no longer attempts the eager first run for a resolved source
  whose kind the run engine can't execute today (`rest_api`/`sql`) — regardless of whether schema
  inference succeeded. The pipeline and source are created; the response's `run` is a `blocked`
  `RunResultResponse` (existing HEL-570 field, no new wire shape) whose `blockedReason` carries the
  fetch error when present, else explains `rest_api`/`sql` execution isn't automated yet.
- Rollback-on-run-failure for `static`/`csv` sources (and dashboard-phase rollback in
  `CombinedProposalService`) is unchanged.
- Both `POST /api/pipelines/apply-proposal` and `POST /api/proposals/apply` (which composes the same
  service) get this fix for free.

## Capabilities

### Modified Capabilities

- `pipeline-proposal-apply`: replaces "Source-fetch failure is a structured, rolled-back error" with a
  requirement that the source/pipeline are created and the run is reported `blocked`; narrows "Full
  rollback on any mid-apply failure" so an execution-unsupported source kind no longer triggers it.

## Non-goals

- Implementing real pipeline execution (Spark job submission or in-process fetch) for `rest_api`/`sql`
  sources — a separate, pre-existing platform gap; filed as a follow-up ticket, not fixed here.
- Persisting a durable "needs attention" connection-status field on `DataSource` — the blocked run's
  `blockedReason`, already visible in the apply response and the pipeline's run history, is sufficient
  evidence for this fix's scope.

## Impact

- `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` (behavior change only;
  `PipelineRunService`/`InProcessPipelineEngine` untouched)
- `backend/src/test/scala/com/helio/api/PipelineApplyProposalRollbackSpec.scala` — two existing
  scenarios rewritten; new coverage added (SQL, existing-sourceId, static/csv unaffected)
- `openspec/specs/pipeline-proposal-apply/spec.md` requirement delta
