## 1. Backend

- [x] 1.1 Add `GET /api/pipelines/:id/steps/:stepId/preview` route to `PipelineRunRoutes`: fetch pipeline, fetch steps, find stepId, slice steps 0..K, execute with `InProcessPipelineEngine`, return first 10 rows as `{ rows: [...], rowCount: N }`
- [x] 1.2 Add `PreviewResponse` case class and JSON formatter to `JsonProtocols` (reuse `RunResultResponse` shape or add dedicated type)
- [x] 1.3 Return 404 if pipeline not found, 404 if stepId not found in steps, 422 if source type is unsupported (RestApi/Sql), 422 on execution error

## 2. Frontend

- [x] 2.1 Add `fetchStepPreview(pipelineId: string, stepId: string)` function to `pipelineService.ts` calling `GET /api/pipelines/:pipelineId/steps/:stepId/preview`
- [x] 2.2 Add `pipelineId` prop to `StepCard` so it can call the preview endpoint
- [x] 2.3 Add component-local state to `StepCard`: `previewOpen`, `previewRows`, `previewLoading`, `previewError`
- [x] 2.4 Wire "Preview data" button: toggle `previewOpen`; on open, fetch preview and update state
- [x] 2.5 Render `StepPreviewTable` inline below the config editor when `previewOpen` is true: table with column headers from first row keys, up to 10 data rows, loading and error states
- [x] 2.6 Pass `pipelineId` (from `useParams`) down to each `StepCard` in `PipelineDetailPage`

## 3. Tests

- [x] 3.1 Add backend ScalaTest cases in `PipelineRunRoutesSpec` (or equivalent): happy path returns first 10 rows, step-not-found returns 404, unsupported source type returns 422
- [x] 3.2 Add/update frontend Jest tests in `PipelineDetailPage.test.tsx`: "Preview data" button triggers fetch, renders table on success, renders error on failure
