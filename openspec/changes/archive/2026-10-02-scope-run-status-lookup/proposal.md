## Why

`GET /api/pipelines/:id/runs/:runId` looks a run up by `runId` alone (`val _ = pipelineId`; `PipelineRunService.status(runId)` takes no user) and returns the run's result rows and error text. Any authenticated caller who holds a run id from another tenant or another pipeline would read it. Found by the HEL-1002 final-gate skeptic; HEL-1002 made every other owner-only miss a byte-identical 404, so this route is the remaining visibility hole in the run surface.

Premise correction (validated against the live tree): the in-memory `PipelineRunCache` this route reads is only written by `SparkJobSubmitter.submit`, which has no caller in main (HEL-202, dormant), and no frontend/MCP client calls this route. So the hole is **latent** (the route 404s on a running backend today); it becomes live the moment the cache is populated. This change closes it before that happens.

## What Changes

- `GET /api/pipelines/:id/runs/:runId` first resolves the pipeline through the caller-visibility lookup (`findByIdShared(pipelineId, Some(user))`), and returns the cached run only if the run was recorded against that same pipeline.
- The cache entry records the owning `pipelineId` at write time so the "run belongs to this pipeline" check is possible.
- A foreign pipeline, an absent pipeline, an absent run, and a run that belongs to a different pipeline all return the **same** 404 (status, content-type, serialized body) -- the HEL-1002 contract. The 404 body no longer echoes the caller-supplied run id differently per case.
- Owner and grantees (editor/viewer) who can see the pipeline still read its runs.
- `ExistenceNotLeakedRoutesSpec` gains rows for this route.

## Capabilities

### New Capabilities
- `pipeline-run-status-access`: visibility and pipeline-scoping contract for `GET /api/pipelines/:id/runs/:runId`.

### Modified Capabilities

## Impact

- `backend/.../routes/pipelines/PipelineRunStatusRoutes.scala`, `services/pipelines/PipelineRunService.scala` (`status`), `spark/PipelineRunCache.scala` (`RunEntry`/`put`/`update`), `spark/SparkJobSubmitter.scala` (pass `pipeline.id`).
- Tests: `ExistenceNotLeakedRoutesSpec`, `PipelineRunRoutesSpec` / any spec constructing `RunEntry` or calling `cache.put`.
- No API shape change on success; no schema/migration.
