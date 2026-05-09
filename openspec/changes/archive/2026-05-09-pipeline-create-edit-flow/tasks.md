## 1. Backend

- [x] 1.1 Add `findById` method to `PipelineRepository` returning `Future[Option[PipelineSummary]]`
- [x] 1.2 Add `updateName` method to `PipelineRepository` accepting `(id, name)` returning `Future[Option[PipelineSummary]]`
- [x] 1.3 Add `GET /api/pipelines/:id` route to `PipelineRoutes` — 200 with summary or 404
- [x] 1.4 Add `PATCH /api/pipelines/:id` route to `PipelineRoutes` — validate name, 200/400/404
- [x] 1.5 Add `UpdatePipelineRequest` case class and JSON format to `JsonProtocols`

## 2. Frontend — Redux

- [x] 2.1 Add `currentPipeline`, `currentPipelineStatus`, `currentPipelineError` to `PipelinesState`
- [x] 2.2 Add `steps` map and `stepsStatus`/`stepsError` per-pipeline to `PipelinesState`
- [x] 2.3 Add `updateStatus` and `updateError` to `PipelinesState`
- [x] 2.4 Implement `fetchPipelineById` thunk calling `GET /api/pipelines/:id`
- [x] 2.5 Implement `fetchPipelineSteps` thunk calling `GET /api/pipelines/:id/steps`
- [x] 2.6 Implement `updatePipeline` thunk calling `PATCH /api/pipelines/:id`
- [x] 2.7 Wire all three thunks into `pipelinesSlice` `extraReducers`
- [x] 2.8 Add `getPipelineById`, `getPipelineSteps` service functions to `pipelineService.ts`
- [x] 2.9 Add `updatePipeline` service function to `pipelineService.ts`

## 3. Frontend — Components

- [x] 3.1 Update `PipelineDetailPage` to dispatch `fetchPipelineById` and `fetchPipelineSteps` on mount
- [x] 3.2 Show loading spinner while `currentPipelineStatus` is `"loading"`
- [x] 3.3 Show error message when `currentPipelineStatus` is `"failed"`
- [x] 3.4 Initialize output name field from `currentPipeline.name` instead of URL id fallback
- [x] 3.5 Track dirty state: compare edited name vs `currentPipeline.name`
- [x] 3.6 Show Save and Cancel buttons only when `isDirty` is true
- [x] 3.7 Save button dispatches `updatePipeline` and navigates to `/pipelines` on success
- [x] 3.8 Save button shows inline error on `updatePipeline` failure
- [x] 3.9 Cancel button shows `window.confirm` prompt when dirty; navigates to `/pipelines` on confirm
- [x] 3.10 Register `beforeunload` handler when dirty; remove it when clean

## 4. Tests

- [x] 4.1 Unit tests for `fetchPipelineById` thunk (success and failure cases)
- [x] 4.2 Unit tests for `fetchPipelineSteps` thunk (success and empty array cases)
- [x] 4.3 Unit tests for `updatePipeline` thunk (success and failure cases)
- [x] 4.4 Unit tests for `PipelineDetailPage` loading state
- [x] 4.5 Unit tests for `PipelineDetailPage` error state
- [x] 4.6 Unit tests for dirty-state detection (Save/Cancel visibility)
- [x] 4.7 Unit tests for Cancel confirmation flow (confirm → navigate, dismiss → stay)
- [x] 4.8 Unit tests for `beforeunload` registration and cleanup
