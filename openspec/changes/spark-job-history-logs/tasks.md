## 1. Backend — Database

- [x] 1.1 Create Flyway migration V24__pipeline_runs.sql with pipeline_runs table, FK, index
- [x] 1.2 Add `PipelineRunRepository` with `insertRun`, `updateRunTerminal`, `deleteOldRuns`, `listByPipeline` methods
- [x] 1.3 Add `PipelineRunRow` case class and `PipelineRunTable` Slick mapping in `PipelineRunRepository`

## 2. Backend — SparkJobSubmitter

- [x] 2.1 Inject `PipelineRunRepository` into `SparkJobSubmitter` constructor
- [x] 2.2 Call `insertRun` at job submission time (status: queued, started_at: now)
- [x] 2.3 Call `updateRunTerminal` on success with `rowCount` (rows.size) and `finished_at`
- [x] 2.4 Call `updateRunTerminal` on failure with `errorLog` (ex.getMessage) and `finished_at`
- [x] 2.5 Add `rowCount` field to `RunStatusResponse` and populate it in `PipelineRunRoutes` on succeeded status

## 3. Backend — API

- [x] 3.1 Add `GET /api/pipelines/:id/run-history` route to `PipelineRunRoutes`
- [x] 3.2 Add `PipelineRunRecord` case class and JSON format in `JsonProtocols`
- [x] 3.3 Wire `PipelineRunRepository` into `PipelineRunRoutes` and `ApiRoutes`
- [x] 3.4 Construct `PipelineRunRepository` in `HttpServer` / `Main` and pass to `SparkJobSubmitter`

## 4. Frontend — Service and Slice

- [x] 4.1 Add `PipelineRunRecord` interface to `types/models.ts`
- [x] 4.2 Add `fetchRunHistory(pipelineId)` function to `pipelineService.ts`
- [x] 4.3 Add `runHistory: Record<string, PipelineRunRecord[]>` to `PipelinesState` in `pipelinesSlice`
- [x] 4.4 Add `fetchPipelineRunHistory` thunk and its fulfilled/pending/rejected cases to `pipelinesSlice`

## 5. Frontend — UI

- [x] 5.1 Add `RunHistoryPanel` component to `PipelineDetailPage.tsx` (collapsible details element)
- [x] 5.2 Render each run row: start time, duration, row count, status badge
- [x] 5.3 Make failed run rows expandable to show errorLog
- [x] 5.4 Show empty state message when runHistory is empty
- [x] 5.5 Dispatch `fetchPipelineRunHistory` on mount in `PipelineDetailPage`
- [x] 5.6 Re-fetch run history after a run reaches a terminal state (succeeded/failed)

## 6. Tests

- [x] 6.1 Add `PipelineRunRepositorySpec` (insert, updateTerminal, deleteOldRuns retention logic)
- [x] 6.2 Update `SparkJobSubmitterSpec` to verify repository calls on success and failure
- [x] 6.3 Add run-history route test in `PipelineRunRoutesSpec` (empty, non-empty, 404)
- [x] 6.4 Update `pipelinesSlice.test.ts` for `fetchPipelineRunHistory` thunk states
- [x] 6.5 Update `PipelineDetailPage.test.tsx` for run history panel rendering
