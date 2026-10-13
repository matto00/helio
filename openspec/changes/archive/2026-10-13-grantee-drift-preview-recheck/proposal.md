## Why

HEL-1503 made an editor grantee's run refresh the schema-drift baseline, but the READ side is still owner-only:
`PipelineRepository.findLastSourceSchema` filters on the caller as owner, so a grantee's analyze never reports drift.
Separately, previews (`PipelineRunPreview`) check access once at entry and never again, so a grant revoked mid-request
still executes the preview -- HEL-1503's re-check (D4) covered dry runs only.

## What Changes

- Analyze computes `sourceSchemaDrift` for every caller as the pipeline OWNER sees it: the baseline is read by
  pipeline id (privileged, after `findByIdShared` confirmed access) and the current primary-root schema used for the
  diff is read via the owner's view (`findByIdOwnedByInternal`). A grantee's drift equals the owner's. The response's
  `sourceSchemas`, step projections and cost verdict stay in the caller's own view.
- Step and output previews re-verify access immediately before executing: pipeline gone -> 404; access lost -> 403;
  never executes. The required access is the same one the preview already demanded: any grant for a closure with no
  enabled AI step, owner-or-editor for a closure containing one (HEL-1108).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-analyze-api`: drift is computed as the pipeline owner sees it, for owner and grantees alike.
- `pipeline-step-preview`: previews re-verify access before executing (403 revoked / 404 gone, no execution).

## Impact

- `backend/.../persistence/pipelines/PipelineRepository.scala` (privileged baseline read, preview access check)
- `backend/.../services/pipelines/PipelineAnalyzeReads.scala`, `PipelineRunPreview.scala`
- Tests: a new NOBYPASSRLS spec; `ExistenceNotLeakedRoutesSpec` Forbidden-producer accounting.
- No migration, no API shape change, no frontend change.

## Non-goals

- Splitting `PipelineRunRepository.scala` (stays on HEL-1503).
- Closing the residual race after the re-check (accepted, same as HEL-1503 D4).
- Changing who may preview (viewers keep non-AI previews).
