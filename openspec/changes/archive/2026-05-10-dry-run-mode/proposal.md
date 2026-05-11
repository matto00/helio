## Why

Pipeline dry runs execute all steps but skip the DataType write — yet they leave no audit trail,
making it impossible to distinguish "this pipeline has never run" from "this pipeline was dry-run
three times." Recording dry runs as a distinct status locks in the dry vs commit contract before
HEL-198 (overwrite mode) lands and gives users visibility into validation runs.

## What Changes

- Backend `PipelineRunRoutes`: on a successful dry run, insert a `pipeline_runs` row with
  `status = "dry_run"` (completed immediately; no queued → terminal transition).
- `PipelineRunRepository`: the existing `insertRun` / `updateRunTerminal` pattern does not fit
  a one-shot dry-run record; add an `insertDryRun` method.
- Frontend service `runPipeline`: accept an optional `dryRun` flag; append `?dry=true` when set.
- Frontend thunk `submitPipelineRun`: accept `{ pipelineId, dryRun }` instead of bare `pipelineId`.
- Frontend type `PipelineRunRecord.status`: add `"dry_run"` as a valid literal.
- Frontend `PipelineDetailPage`: add a "Dry run" secondary button next to "Run pipeline";
  dispatch `submitPipelineRun` with `dryRun: true` on click.
- Frontend `StatusBadge` / run history CSS: render `"dry_run"` rows with a distinct badge
  (e.g., "Dry run" label, muted color).

## Capabilities

### New Capabilities
- `pipeline-dry-run-ui`: "Dry run" button on the pipeline detail page and "Dry run" badge
  in run history panel.

### Modified Capabilities
- `pipeline-run-execution`: existing requirement "Dry run does not create a pipeline_runs record"
  is being CHANGED to "Dry run creates a pipeline_runs row with status = dry_run".

## Impact

- `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala` — new method
- `backend/src/main/scala/com/helio/api/routes/PipelineRunRoutes.scala` — dry run branch change
- `frontend/src/services/pipelineService.ts` — `runPipeline` gains optional `dryRun` param
- `frontend/src/features/pipelines/pipelinesSlice.ts` — `submitPipelineRun` arg type change
- `frontend/src/types/models.ts` — `PipelineRunRecord.status` union extended
- `frontend/src/components/PipelineDetailPage.tsx` — new button + badge styling
- `frontend/src/components/PipelineDetailPage.css` — new CSS for dry-run status
- Backend test: `PipelineRunRoutesSpec` / `ApiRoutesSpec` — new dry-run row scenario
- Frontend test: `pipelinesSlice.test.ts`, `PipelineDetailPage.test.tsx`

## Non-goals

- No alignment with step preview (HEL-195).
- No Spark integration.
- No overwrite mode (HEL-198).
- No change to the `?dry=true` query-param wire format — backend keeps existing param.
