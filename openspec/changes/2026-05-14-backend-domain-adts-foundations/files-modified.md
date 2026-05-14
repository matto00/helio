# Files modified — backend-domain-adts (CS2c)

Foundations only (Task 1). Other tasks not yet started; see `executor-report-1.md`.

## Domain

- `backend/src/main/scala/com/helio/domain/model.scala` — added `PipelineRunId` value class

## API protocols

- `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — added `PipelineStepIdSegment`, `PipelineRunIdSegment`

## Infrastructure (repository ID narrowing)

- `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala` — `exists/findById/findSummaryById/updateName/delete/updateLastRun` accept `PipelineId`; `create` accepts `DataSourceId`
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — `listByPipeline/insert` accept `PipelineId`; `update/delete` accept `PipelineStepId`
- `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala` — all methods accept `PipelineRunId` / `PipelineId` value classes

## Services

- `backend/src/main/scala/com/helio/services/PipelineService.scala` — call sites updated to pass value-class IDs; `updateStep/deleteStep` now accept `PipelineStepId`

## Routes

- `backend/src/main/scala/com/helio/api/routes/PipelineRunRoutes.scala` — uses `pidValue: PipelineId` for repo calls; wraps generated `runId` into `PipelineRunId`
- `backend/src/main/scala/com/helio/api/routes/PipelineStepRoutes.scala` — uses `PipelineStepIdSegment` for `/pipeline-steps/:id` matcher

## Spark integration

- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — wraps runId in `PipelineRunId` for repo calls; keeps `runIdStr` for the cache key (cache still uses String keys)

## Tests (call-site updates only — no behavior changes)

- `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/PipelineRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/PipelineRunRepositorySpec.scala`
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala`
