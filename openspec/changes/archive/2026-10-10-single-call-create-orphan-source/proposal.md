## Why

`POST /api/pipelines` with an inline root source and a bad step or Output config returns 4xx but leaves the inline source behind as an orphan (observed live by HEL-1422's final skeptic). Single-call create is meant to be all-or-nothing; today the pipeline/steps/Outputs are atomic but the inline source is committed before that transaction even begins.

## What Changes

- Every request-only validation of single-call create (step clientId uniqueness, step type, `parentStepId` resolution, raw step config / decode, forward lane reference, Output name/kind/`nodeStepClientId`, Output config keys/compare/payload opt-in, root `rootClientId` resolution, inline-root spec shape) runs BEFORE any write, so these failure classes create nothing at all.
- Existing-`sourceId` roots are ownership-checked (read-only) before any inline root source is created, so a later bad root no longer leaks an earlier root's inline source.
- Any failure AFTER inline root sources have been created (a schema-dependent `fieldMapping` check, a cross-owner reference, the cycle guard, a DB error, a later inline root failing to create, the simple-create path's `pipelineRepo.create`) deletes every inline source this call created before the error is returned.
- Patch-set `pipeline/create` resolution runs the same request-only pre-flight, so those failures surface at resolve time with nothing applied; apply-time failures inherit the service-level cleanup.
- Patch-set mid-set rollback of a successfully-applied inline-root pipeline create (a later edit in the same apply failed) also deletes the inline source(s) it created, not just the pipeline.
- No API shape change; on the direct `POST /api/pipelines` route status codes per single-error failure class are unchanged. On the patch-set path, a pipeline-create edit with an unknown step type or disallowed Output config is now refused at resolve time (apply AND preview, 4xx with `edit N: ` prefix) instead of today's HTTP 200 forward-apply `failure` / 200 preview projection -- extending HEL-1402's same move for refused step configs. Error precedence changes only in that request-only step/Output errors are now reported before an inline root source is created (and before that creation's own failure).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-create-api`: the "any failure rolls back the whole call" guarantee is extended to cover inline root sources created by the same call, per failure class (step config 422, unknown step type 400, Output config 400), and the patch-set pipeline-create edit.

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` (create / createTransactional / root resolution).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` (`resolvePipelineCreate`), `PatchSetApplyRollback.scala` (`PipelineCreate` rollback).
- New/extended backend specs with embedded Postgres, counting `data_sources` rows by exact owner id.
- No migration, no frontend, no schema change.
