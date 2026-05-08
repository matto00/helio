## Why

Pipeline runs are already submitted to Spark and tracked in an in-memory cache, but the frontend
has no way to observe run progress and the pipeline record's `lastRunStatus` / `lastRunAt` columns
are never updated after a run completes. Users cannot see whether a pipeline is running, succeeded,
or failed without manually inspecting the backend.

## What Changes

- Add `updateLastRun` to `PipelineRepository` and call it from `SparkJobSubmitter` on terminal
  states (succeeded / failed).
- Expose `POST /api/pipelines/:id/run` and `GET /api/pipelines/:id/runs/:runId` in the API
  contract (these routes exist in `PipelineRunRoutes` but are not yet wired to the frontend).
- Add `runPipeline` and `fetchRunStatus` service calls and thunks to the frontend.
- Replace the placeholder `handleRunPipeline` alert in `PipelineDetailPage` with a real run
  flow: submit the job, poll `GET /api/pipelines/:id/runs/:runId` until terminal, then display
  the result status inline.
- Surface a run-status indicator (queued / running / succeeded / failed) in `PipelineDetailPage`
  footer while polling is active.

## Capabilities

### New Capabilities

- `pipeline-run-status`: Frontend polls the backend for async Spark job status and surfaces it
  in a run-status indicator on the pipeline detail page.

### Modified Capabilities

- `pipeline-create-api`: The pipeline record's `lastRunStatus` and `lastRunAt` fields SHALL be
  updated in the database when a run reaches a terminal state (succeeded or failed). Currently
  these fields are never written after creation.

## Impact

- **Backend**: `PipelineRepository` gains `updateLastRun`; `SparkJobSubmitter.submit` is updated
  to call it on completion; `PipelineRunRoutes` is unchanged (routes already exist).
- **Frontend**: `pipelineService.ts` gains `runPipeline` and `fetchRunStatus`; `pipelinesSlice`
  gains `submitPipelineRun` thunk; `PipelineDetailPage` gains run-status polling logic and
  status indicator UI.
- **No new external dependencies** — polling uses `setInterval` / `clearInterval`; no WebSocket
  or SSE required.

## Non-goals

- Real-time streaming of row-level results (out of scope; results are available after PASS via
  the existing `rows` field but are not streamed).
- Surfacing run history / multiple runs per pipeline.
- Cancelling an in-progress run.
