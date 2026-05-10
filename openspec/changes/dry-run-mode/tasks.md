## 1. Backend

- [x] 1.1 Add `insertDryRun(runId, pipelineId, startedAt, rowCount)` method to `PipelineRunRepository` that inserts a completed row with `status = "dry_run"` and `completed_at = startedAt`
- [x] 1.2 Update `PipelineRunRoutes` dry-run success branch: call `pipelineRunRepo.insertDryRun` with the result row count after execution succeeds (null-safe guard when `pipelineRunRepo` is null)

## 2. Frontend

- [x] 2.1 Update `runPipeline` in `pipelineService.ts` to accept optional `dryRun?: boolean` and append `?dry=true` to the URL when set
- [x] 2.2 Update `submitPipelineRun` thunk arg type from `string` to `{ pipelineId: string; dryRun?: boolean }`; thread `dryRun` to the service call
- [x] 2.3 Add `"dry_run"` to `PipelineRunRecord.status` union type in `models.ts`
- [x] 2.4 Add a "Dry run" secondary button to the pipeline detail page footer (left of "Run pipeline"); wire click to `submitPipelineRun({ pipelineId: id, dryRun: true })`; disable while `runStatus` is `"queued"` or `"running"`
- [x] 2.5 Update `handleRunPipeline` call-site to pass `{ pipelineId: id }` (matches new arg shape)
- [x] 2.6 Update `StatusBadge` to render `"Dry run"` text for `status === "dry_run"`
- [x] 2.7 Add CSS for `.pipeline-detail-page__run-status--dry_run` (muted/neutral color) and `.pipeline-detail-page__dry-run-btn` in `PipelineDetailPage.css`

## 3. Tests

- [x] 3.1 Backend: add `PipelineRunRepository` unit test asserting `insertDryRun` inserts a row with `status = "dry_run"` and non-null `completed_at`
- [x] 3.2 Backend: add `ApiRoutesSpec` / `PipelineRunRoutesSpec` scenario asserting that `POST /api/pipelines/:id/run?dry=true` on success records a `dry_run` row in the repository
- [x] 3.3 Frontend: update `pipelinesSlice.test.ts` to cover `submitPipelineRun({ pipelineId, dryRun: true })` dispatching POST with `?dry=true`
- [x] 3.4 Frontend: add `PipelineDetailPage.test.tsx` assertions for "Dry run" button presence and `status = "dry_run"` badge rendering
