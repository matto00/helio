## Why

Pipeline runs are now submitted and tracked (HEL-202, HEL-203), but the detail view only shows
the current run's live status — there is no history. Users cannot audit past runs, review failure
logs, or see row counts without re-running a pipeline. Retaining a per-pipeline run log is needed
to make pipelines operationally useful.

## What Changes

- Add a `pipeline_runs` table (Flyway migration) with columns: `id`, `pipeline_id` (FK),
  `started_at`, `finished_at` (nullable), `status` (`queued | running | succeeded | failed`),
  `row_count` (nullable int), `error_log` (nullable text). Retain the last N runs per pipeline
  (N = 10, enforced by a trigger or cleanup call in the repository).
- Persist each run to the database in `SparkJobSubmitter`: insert on submission, update on
  terminal state.
- Add `GET /api/pipelines/:id/run-history` — returns an array of run records ordered by
  `started_at` DESC, capped at N.
- Add a "Run History" tab or section to `PipelineDetailPage`. Each row shows: start time,
  duration (computed from `started_at` / `finished_at`), row count, and status badge. Failed
  rows are expandable to reveal `error_log`.

## Capabilities

### New Capabilities

- `pipeline-run-history`: Backend persists run records and exposes a history API; frontend
  renders the run history list in the pipeline detail page.

### Modified Capabilities

- `pipeline-run-status`: The `POST /api/pipelines/:id/run` and `GET /api/pipelines/:id/runs/:runId`
  responses gain a `rowCount` field on success so the in-flight polling path also has access to it.

## Impact

- **Backend**: new Flyway migration (V24 or next); `PipelineRunRepository` (new); `SparkJobSubmitter`
  updated to persist runs; `ApiRoutes` gains one new route; `JsonProtocols` gains run-history types.
- **Frontend**: `pipelineService` gains `fetchRunHistory`; `pipelinesSlice` gains `runHistory`
  state + `fetchPipelineRunHistory` thunk; `PipelineDetailPage` renders history panel.
- **Database**: new `pipeline_runs` table with a retention cap (last 10 runs per pipeline).
- **No new external dependencies**.

## Non-goals

- Real-time streaming of logs during an active run (logs are captured at completion only).
- Cancelling in-flight runs.
- Run history visible in the pipeline list view (only in the detail view).
- Configuring N per-pipeline (fixed at 10 for now).
