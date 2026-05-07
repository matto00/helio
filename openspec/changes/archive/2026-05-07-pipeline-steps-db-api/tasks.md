## 1. Backend — DB Migration

- [x] 1.1 Create `backend/src/main/resources/db/migration/V23__pipeline_steps.sql` with table, CHECK constraint, and index

## 2. Backend — Domain and Repository

- [x] 2.1 Add `PipelineStep` case class to `domain/model.scala` (id, pipelineId, position, op, config, createdAt, updatedAt)
- [x] 2.2 Add `CreatePipelineStepRequest` and `UpdatePipelineStepRequest` case classes to `JsonProtocols.scala`
- [x] 2.3 Add `PipelineStepResponse` case class and JSON format to `JsonProtocols.scala`
- [x] 2.4 Create `infrastructure/PipelineStepRepository.scala` with `PipelineStepRow`, `PipelineStepTable`, `listByPipeline`, `insert`, `update`, `delete`

## 3. Backend — Routes and Wiring

- [x] 3.1 Create `api/routes/PipelineStepRoutes.scala` with GET `/pipelines/:id/steps`, POST `/pipelines/:id/steps`, PATCH `/pipeline-steps/:id`, DELETE `/pipeline-steps/:id`
- [x] 3.2 Wire `PipelineStepRepository` and `PipelineStepRoutes` into `app/` (server startup / dependency injection)
- [x] 3.3 Mount `PipelineStepRoutes` in `ApiRoutes.scala`

## 4. Tests

- [x] 4.1 Add backend Scala tests for `PipelineStepRoutes` covering all four endpoints (happy path + 404 cases)
