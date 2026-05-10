## 1. Backend

- [x] 1.1 In `PipelineRunRoutes.scala` non-dry success path: generate a UUID run ID, call `pipelineRunRepo.insertRun` and `pipelineRunRepo.deleteOldRuns` before execution, then `pipelineRunRepo.updateRunTerminal` with status `succeeded` and `rowCount` after execution
- [x] 1.2 In `PipelineRunRoutes.scala` non-dry failure path: call `pipelineRunRepo.updateRunTerminal` with status `failed` and `errorLog` set to the error message (null-guard both paths with `if (pipelineRunRepo != null)`)

## 2. Tests

- [x] 2.1 In `PipelineRunRoutesSpec.scala`: add a test that `POST /api/pipelines/:id/run` (non-dry, success) inserts a `pipeline_runs` row with `status = "succeeded"` and correct `rowCount`
- [x] 2.2 In `PipelineRunRoutesSpec.scala`: add a test that `POST /api/pipelines/:id/run` (non-dry, failure via bad join step) inserts a `pipeline_runs` row with `status = "failed"` and non-empty `errorLog`
- [x] 2.3 In `PipelineDetailPage.test.tsx`: add a test that the Run button is disabled when `runStatus` is `"queued"` and enabled when `runStatus` is `null`
- [x] 2.4 In `PipelineDetailPage.test.tsx`: add a test that clicking Run dispatches `submitPipelineRun` and then `fetchPipelineRunHistory`
