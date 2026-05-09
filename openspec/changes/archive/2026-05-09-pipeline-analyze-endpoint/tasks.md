## 1. Backend

- [x] 1.1 Add `SchemaField(name: String, `type`: String)` case class and `PipelineAnalyzeService` object to `backend/src/main/scala/com/helio/domain/` with inference logic for all 8 ops (select, rename, cast, filter, compute, aggregate, limit, sort) and malformed-config validationError fallback
- [x] 1.2 Add response case classes `SchemaFieldResponse`, `AnalyzeStepResponse`, `PipelineAnalyzeResponse` to `JsonProtocols.scala` with their Spray JSON formatters
- [x] 1.3 Add `GET /api/pipelines/:id/analyze` route to `PipelineRoutes.scala`; fetch pipeline summary, source DataType via `findBySourceId`, steps, run `PipelineAnalyzeService`, return `PipelineAnalyzeResponse`
- [x] 1.4 Add `dataTypeRepo` to `PipelineRoutes` constructor (needed for `findBySourceId` call); update `ApiRoutes.scala` wiring accordingly

## 2. Schema / Spec

- [x] 2.1 Add `schemas/pipeline-analyze-response.json` (JSON Schema 2020-12) describing the analyze response shape
- [x] 2.2 Add OpenAPI operation `GET /api/pipelines/{id}/analyze` to the relevant spec file in `openspec/specs/`

## 3. Frontend

- [x] 3.1 Add `analyzePipeline(pipelineId: string)` to `frontend/src/services/pipelinesService.ts`
- [x] 3.2 Add `PipelineAnalyzeResponse` TypeScript type to `frontend/src/types/models.ts`
- [x] 3.3 Add `analyzePipeline` async thunk and `analyzeResult` state slice to `pipelinesSlice`
- [x] 3.4 Add `useAnalyzePipeline(pipelineId)` hook that dispatches the thunk on mount
- [x] 3.5 Wire `useAnalyzePipeline` into `PipelineDetailPage`; pass `inputSchema` field names for the relevant step down to `SelectFieldsConfig` as `columns`
- [x] 3.6 Remove the "Run the pipeline to preview available fields." fallback from `SelectFieldsConfig`; render empty checklist when `columns` is empty

## 4. Tests

- [x] 4.1 Backend unit tests for `PipelineAnalyzeService`: select inference, rename inference, cast inference, filter/limit/sort identity, compute inference, aggregate inference, malformed-config validationError, empty step list, renamed-field cascade
- [x] 4.2 Backend integration test in `ApiRoutesSpec` (or new `PipelineAnalyzeRoutesSpec`): 404 for missing pipeline, 200 with correct schemas for a pipeline with a select step
- [x] 4.3 Frontend unit tests for `SelectFieldsConfig`: renders checklist from `columns` prop; renders empty list (not prompt) when `columns` is empty; toggling checkbox calls `onToggle`
