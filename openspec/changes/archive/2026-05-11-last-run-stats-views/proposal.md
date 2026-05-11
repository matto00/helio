## Why

Pipeline list and detail views already display last-run status and timestamp, but omit the row count
written by each run. Surfacing `lastRunRowCount` alongside the existing fields completes the
at-a-glance operational picture operators need to verify pipeline health.

## What Changes

- Add `last_run_row_count` column to the `pipelines` table via Flyway migration.
- Extend `PipelineRepository.updateLastRun` to also persist row count.
- Extend `PipelineSummary` (backend DTO + Scala response type) with `lastRunRowCount: Option[Long]`.
- Extend frontend `PipelineSummary` interface with `lastRunRowCount: number | null`.
- Update `PipelineListTable`: add a "Rows Written" column; format `lastRunAt` as relative time
  (e.g. "2 hours ago") instead of raw ISO string; show "Never run" when all last-run fields are null.
- Update `PipelineDetailPage`: add a compact metadata bar below the back breadcrumb showing
  last-run timestamp (relative), row count, and status badge for the persisted last run.
- Add a "data as of [timestamp]" indicator to panels whose `typeId` is bound to a DataType that
  has an associated pipeline with a `lastRunAt`. This requires either an API join or client-side
  lookup via `outputDataTypeId` on the pipelines list.

## Capabilities

### New Capabilities

- `pipeline-last-run-row-count`: Persists and surfaces the row count from the most-recent
  non-dry run in list and detail views.
- `panel-data-freshness-indicator`: "Data as of [timestamp]" label on bound panels, sourced from
  the pipeline that writes to the panel's DataType.

### Modified Capabilities

- `pipeline-list-api`: Extend `PipelineSummary` with `lastRunRowCount` field; persist row count on
  `updateLastRun`; include relative-time display hint.
- `pipeline-list-view`: Add "Rows Written" column and relative-time formatting to the table;
  "Never run" label when pipeline has no committed run.
- `pipeline-editor-page`: Add persistent last-run metadata bar (timestamp, row count, status)
  to the detail page header area.

## Impact

- Backend: `PipelineRepository`, `JsonProtocols.PipelineSummaryResponse`, `PipelineRunRoutes`
  (updateLastRun call site), Flyway migration V{N}__add_pipeline_last_run_row_count.sql.
- Frontend: `models.ts` (PipelineSummary), `PipelineListTable.tsx`, `PipelineDetailPage.tsx`,
  `pipelinesSlice.ts` (fixture updates in tests).
- JSON schema: no existing `pipeline-summary.schema.json` — no schema gate impact.
- Tests: backend repository test for row count persistence; frontend tests for new columns and
  metadata bar rendering.

## Non-goals

- Querying `pipeline_runs` table directly for the last-run row count (the `pipelines` table already
  maintains the denormalized `last_run_at` / `last_run_status`; we add `last_run_row_count` to the
  same pattern for consistency and query simplicity).
- Dry runs: only non-dry runs update `last_run_*` fields.
- "Data as of" indicator on panels: **explicitly deferred to a future ticket**. AC #4 in the
  ticket description calls for a "data as of [timestamp]" label on panels bound to a DataType
  whose associated pipeline exposes a `lastRunAt`. Implementing this requires a new API join
  between panels, data types, and pipelines for which no existing infrastructure exists. Scoping
  it out avoids a large cross-cutting change; it should be tracked as a dedicated follow-up
  (e.g. a `panel-data-freshness` capability) once the pipeline-to-DataType binding work is in
  place.
