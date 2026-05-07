## 1. Backend

- [x] 1.1 Add `CreatePipelineRequest` case class to `JsonProtocols.scala` with fields `name`, `sourceDataSourceId`, `outputDataTypeName`
- [x] 1.2 Add `createPipelineRequestFormat` implicit JSON formatter for `CreatePipelineRequest`
- [x] 1.3 Add `create(name: String, sourceDataSourceId: String, outputDataTypeName: String)` method to `PipelineRepository` that inserts a DataType row then a Pipeline row and returns the created `PipelineSummary`
- [x] 1.4 Add `POST /api/pipelines` route to `PipelineRoutes.scala` that validates the request body, calls `pipelineRepo.create`, and returns `201 Created` with the summary on success or `400`/`404` on error
- [x] 1.5 Wire `DataTypeRepository` injection into `PipelineRoutes` / `PipelineRepository` so DataType insertion works

## 2. Frontend

- [x] 2.1 Add `createPipeline(payload: { name: string; sourceDataSourceId: string; outputDataTypeName: string })` service function to `pipelineService.ts` calling `POST /api/pipelines`
- [x] 2.2 Add `createPipeline` async thunk and handle pending/fulfilled/rejected in `pipelinesSlice.ts`; store a `createStatus` and `createError` field in slice state
- [x] 2.3 Create `CreatePipelineModal.tsx` component with name text input, data source select, and output type name text input; dispatch `fetchDataSources` on open if not loaded; show inline validation errors on empty-field submit
- [x] 2.4 On valid submit, dispatch `createPipeline`, navigate to `/pipelines/:id` on success, dispatch `fetchPipelines`, close modal
- [x] 2.5 Show an error message inside the modal if `createPipeline` rejects
- [x] 2.6 Update `PipelineEmptyState.tsx` to accept an `onCreateClick` prop and call it when "Create pipeline" is clicked
- [x] 2.7 Update `PipelinesPage.tsx` to manage modal open/close state, pass `onCreateClick` to `PipelineEmptyState`, and render `CreatePipelineModal`
- [x] 2.8 Add a toolbar `<div>` with a "Create pipeline" button above `PipelineListTable` in `PipelinesPage.tsx`; wire it to open the modal

## 3. Tests

- [x] 3.1 Add unit tests for `createPipeline` thunk in `pipelinesSlice.test.ts` covering fulfilled and rejected cases
- [x] 3.2 Add/update `PipelinesPage.test.tsx` to verify "Create pipeline" button opens modal in empty state and non-empty state
- [x] 3.3 Add `CreatePipelineModal.test.tsx` covering: field rendering, inline validation, successful submit flow, and error display
