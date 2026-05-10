# Files Modified — dry-run-mode

- `backend/src/main/resources/db/migration/V28__pipeline_runs_dry_run_status.sql` — Flyway migration extending the `pipeline_runs.status` CHECK constraint to include `"dry_run"` (previous constraint was hard-coded to the four existing statuses)
- `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala` — added `insertDryRun` method that inserts a completed row with `status = "dry_run"` and `completed_at = startedAt`
- `backend/src/main/scala/com/helio/api/routes/PipelineRunRoutes.scala` — updated dry-run success branch to call `pipelineRunRepo.insertDryRun` with result row count; null-safe guarded
- `backend/src/test/scala/com/helio/infrastructure/PipelineRunRepositorySpec.scala` — added test asserting `insertDryRun` produces `status = "dry_run"` with non-null `completedAt`
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` — added scenario asserting `POST /api/pipelines/:id/run?dry=true` records a `dry_run` row with correct rowCount
- `frontend/src/services/pipelineService.ts` — `runPipeline` now accepts optional `dryRun?: boolean`; appends `?dry=true` when set
- `frontend/src/features/pipelines/pipelinesSlice.ts` — `submitPipelineRun` arg type changed from `string` to `{ pipelineId: string; dryRun?: boolean }`; threads `dryRun` to service call
- `frontend/src/types/models.ts` — added `"dry_run"` to `PipelineRunRecord.status` union
- `frontend/src/components/PipelineDetailPage.tsx` — added `handleDryRun` handler; added "Dry run" secondary button to footer; updated `handleRunPipeline` call-site to new arg shape; updated `StatusBadge` to render "Dry run" label for `"dry_run"` status
- `frontend/src/components/PipelineDetailPage.css` — added `.pipeline-detail-page__run-status--dry_run` (muted/neutral color with dashed border) and `.pipeline-detail-page__dry-run-btn` styles
- `frontend/src/features/pipelines/pipelinesSlice.test.ts` — updated existing tests to use new `{ pipelineId }` arg shape; added dry-run thunk test asserting `runPipeline` called with `(pipelineId, true)`
- `frontend/src/components/PipelineDetailPage.test.tsx` — updated `toHaveBeenCalledWith` assertions for new arg shape; added HEL-197 describe block with button presence, disabled states, and `dry_run` badge tests
