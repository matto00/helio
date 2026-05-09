## 1. Backend

- [x] 1.1 Add `updateLastRun(id: String, status: String, at: Instant): Future[Unit]` to `PipelineRepository`
- [x] 1.2 Inject `PipelineRepository` into `SparkJobSubmitter` constructor
- [x] 1.3 Call `updateLastRun` on `RunStatus.Succeeded` inside the `try` block of `SparkJobSubmitter.submit`
- [x] 1.4 Call `updateLastRun` on `RunStatus.Failed` inside the `catch` block of `SparkJobSubmitter.submit`
- [x] 1.5 Wire updated `SparkJobSubmitter` constructor in `Main.scala` / `HttpServer.scala`

## 2. Frontend

- [x] 2.1 Add `runPipeline(pipelineId: string): Promise<{ runId: string }>` to `pipelineService.ts`
- [x] 2.2 Add `fetchRunStatus(pipelineId: string, runId: string): Promise<RunStatusResponse>` to `pipelineService.ts`
- [x] 2.3 Add `RunStatusResponse` interface to `frontend/src/types/models.ts`
- [x] 2.4 Add `runId`, `runStatus`, `runError` fields to `PipelinesState` in `pipelinesSlice.ts`
- [x] 2.5 Add `submitPipelineRun` async thunk that calls `runPipeline` and stores the returned `runId`
- [x] 2.6 Add `clearRunState` reducer action to `pipelinesSlice`
- [x] 2.7 Replace `handleRunPipeline` stub in `PipelineDetailPage` with dispatch of `submitPipelineRun`
- [x] 2.8 Add `useEffect` polling loop in `PipelineDetailPage` that calls `fetchRunStatus` every 2 s while `runId` is set and status is non-terminal; clean up interval on unmount or terminal state
- [x] 2.9 Add run-status indicator element in the `PipelineDetailPage` footer showing current `runStatus` (idle / queued / running / succeeded / failed)

## 3. Tests

- [x] 3.1 Add `PipelineRepositorySpec` test: `updateLastRun` sets `lastRunStatus` and `lastRunAt` on the correct row
- [x] 3.2 Add `SparkJobSubmitterSpec` test: on success, `updateLastRun` is called with `succeeded`
- [x] 3.3 Add `SparkJobSubmitterSpec` test: on failure, `updateLastRun` is called with `failed`
- [x] 3.4 Add `PipelineRunRoutesSpec` test: `POST /api/pipelines/:id/run` returns 201 with runId
- [x] 3.5 Add `PipelineRunRoutesSpec` test: `GET /api/pipelines/:id/runs/:runId` returns status from cache
- [x] 3.6 Add `pipelinesSlice.test.ts` test: `submitPipelineRun` fulfilled sets `runId` in state
- [x] 3.7 Add `PipelineDetailPage.test.tsx` test: clicking "Run pipeline" dispatches `submitPipelineRun`
- [x] 3.8 Add `PipelineDetailPage.test.tsx` test: status indicator reflects `runStatus` from Redux state
