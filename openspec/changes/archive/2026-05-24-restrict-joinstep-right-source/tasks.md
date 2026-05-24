## 1. Backend

- [x] 1.1 Add `DataSourceRepository` constructor parameter to `PipelineService`
- [x] 1.2 In `PipelineService.addStep`, after config validation and before `pipelineRepo.exists`, extract `rightDataSourceId` when `type == "join"` and call `dataSourceRepo.findByIdOwned`; return `Left(ServiceError.NotFound(...))` if `None`
- [x] 1.3 In `PipelineService.updateStep`, after fetching `existing` and confirming it is a `join` step, check `rightDataSourceId` from the incoming config with `dataSourceRepo.findByIdOwned`; return `Left(ServiceError.NotFound(...))` if `None`
- [x] 1.4 Update `ApiRoutes` to pass `dataSourceRepo` as the third constructor argument to `PipelineService`

## 2. Tests

- [x] 2.1 In `PipelineStepRoutesSpec`, add test fixture helpers: seed a second user and a data source owned by that second user
- [x] 2.2 Add test: cross-user JoinStep `POST /api/pipelines/:id/steps` returns 404
- [x] 2.3 Add test: owner JoinStep `POST /api/pipelines/:id/steps` with own source returns 201 and evaluation proceeds
