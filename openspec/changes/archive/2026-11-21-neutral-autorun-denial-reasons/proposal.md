## Why

HEL-1661 gave pipeline grantees neutral reason text on analyze, but the dataset-write auto-run trigger still returns the estimator's raw `detail` (for example "Estimated 12345 rows exceeds the auto-run threshold of 10000") to any writer holding a grant on the denied pipeline. A dashboard editor submitting a form (HEL-1784), or a dataset owner writing to a source another user's pipeline reads, can therefore learn the pipeline owner's data size.

## What Changes

- The auto-run denial returned in a write response (`deniedPipelines[].reasons[]`) carries, for a writer who is not the denied pipeline's owner, each estimator reason's `code` and `stepId` unchanged and a fixed neutral `detail` taken from the same per-code table HEL-1661 uses on analyze (unknown code: the same generic sentence). `step-config-invalid` reasons keep their text, exactly as analyze keeps them for non-owners (it is schema-independent, a function of the step's own configuration).
- The pipeline owner's own write keeps the full detail.
- The server log line keeps the full detail for every denial (unchanged).
- No response shape change: same fields, same types; the web client renders copy by `code` only and never reads `detail`.

Responses affected (all built from one place): row append (`POST /api/data-sources/:id/rows`), row replace (`PUT /api/data-sources/:id/rows`), row update (`PATCH /api/data-sources/:id/rows/:rowId`), form submit (`POST /api/panels/:id/submit`, including the file-field path). Row delete (`DELETE /api/data-sources/:id/rows/:rowId`) returns `204` with no body and carries no denial.

## Capabilities

### New Capabilities

### Modified Capabilities
- `dataset-write-auto-run`: adds a requirement that a write response's auto-run denial reasons are neutral for a writer who is not the pipeline's owner.

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/AutoRunTriggerService.scala` (`handleDenied`), reusing `PipelineAnalyzeReads.NeutralReasonDetail` / `GenericReasonDetail` (read only; HEL-1799 may edit that file).
- Backend tests: `AutoRunTriggerServiceSpec` / `DataSourceServiceDeniedPipelinesSpec` and a form-submit editor route-level test.
- No schema, client, migration or MCP change.
