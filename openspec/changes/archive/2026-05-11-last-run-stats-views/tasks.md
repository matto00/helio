## 1. Backend

- [x] 1.1 Add Flyway migration V30__pipeline_last_run_row_count.sql: ALTER TABLE pipelines ADD COLUMN last_run_row_count BIGINT
- [x] 1.2 Add `lastRunRowCount: Option[Long]` to `PipelineRepository.PipelineRow` and `PipelineTable` column definition
- [x] 1.3 Extend `PipelineRepository.PipelineSummary` DTO with `lastRunRowCount: Option[Long]`
- [x] 1.4 Update `PipelineRepository.updateLastRun` signature to accept `rowCount: Long` and write `last_run_row_count`
- [x] 1.5 Update all `findSummaryById` and `listSummaries` mappings to include `lastRunRowCount`
- [x] 1.6 Update `create` and `findById`→summary mappings to pass `lastRunRowCount = None`
- [x] 1.7 Update callers of `updateLastRun` in `PipelineRunRoutes` to pass the row count from the run result
- [x] 1.8 Add `lastRunRowCount: Option[Long]` to `PipelineSummaryResponse` in `JsonProtocols`; update `jsonFormat7` → `jsonFormat8`

## 2. Frontend

- [x] 2.1 Add `lastRunRowCount: number | null` to `PipelineSummary` interface in `models.ts`
- [x] 2.2 Implement `formatRelativeTime(iso: string): string` utility (no third-party lib) in a shared utils file
- [x] 2.3 Update `PipelineListTable`: add "Rows Written" column; format `lastRunAt` via `formatRelativeTime`; show "Never run" when `lastRunStatus` is null
- [x] 2.4 Add `pipeline-detail-page__meta-bar` section to `PipelineDetailPage` showing relative timestamp, row count, and status badge when `lastRunAt` is non-null
- [x] 2.5 Add CSS for `pipeline-detail-page__meta-bar` in `PipelineDetailPage.css`

## 3. Tests

- [x] 3.1 Backend: add `PipelineRepositorySpec` (or extend existing) to test `updateLastRun` persists `lastRunRowCount`, and `listSummaries` returns it correctly
- [x] 3.2 Frontend: update `PipelinesPage.test.tsx` fixtures to include `lastRunRowCount`; assert "Rows Written" column renders correct value and "—" for null
- [x] 3.3 Frontend: update `PipelineDetailPage.test.tsx` fixtures to include `lastRunRowCount`; assert meta bar is visible when `lastRunAt` is non-null and absent when null
- [x] 3.4 Frontend: update any other fixture files that reference `PipelineSummary` to add `lastRunRowCount` (pipelinesSlice.test, CreatePipelineModal.test, PanelList.test, PanelCreationModal.test)
