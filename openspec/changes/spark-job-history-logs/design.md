## Context

The backend has `SparkJobSubmitter` (HEL-202) which submits Spark jobs and updates
`pipelines.last_run_status` / `pipelines.last_run_at` on completion (HEL-203). The in-memory
`PipelineRunCache` holds live status but is not durable — a server restart discards all run
entries. There is no `pipeline_runs` table, no history API, and no history UI in
`PipelineDetailPage`. The next Flyway migration available is V24.

## Goals / Non-Goals

**Goals:**
- Persist every run as a row in a new `pipeline_runs` table (V24 migration).
- Trim the table to the last 10 runs per pipeline after each insert (enforced in the repository).
- Expose `GET /api/pipelines/:id/run-history` returning runs ordered by `started_at` DESC.
- Add `fetchPipelineRunHistory` thunk + `runHistory` state to `pipelinesSlice`.
- Render a "Run History" panel in `PipelineDetailPage` below the footer.

**Non-Goals:**
- Streaming logs during an active run.
- Configurable N per pipeline.
- Cancellation.
- Run history in the pipeline list view.

## Decisions

**D1 — New `PipelineRunRepository` (not expanding `PipelineRepository`).**
`PipelineRepository` is already responsible for pipeline CRUD and `updateLastRun`. Adding run-history
persistence there would blur responsibilities. A dedicated `PipelineRunRepository` follows the pattern
of `PipelineStepRepository` — injected into both `SparkJobSubmitter` and `PipelineRunRoutes`.

**D2 — Retention enforced by a DELETE after INSERT in `PipelineRunRepository`.**
A database trigger is harder to test and vendor-coupled. A `deleteOldRuns(pipelineId, keepN=10)`
call immediately after `insertRun` is simple, readable, and testable. Race conditions between two
concurrent runs on the same pipeline are benign (at most N+1 rows briefly).

**D3 — `error_log` stores the full exception message from `SparkJobSubmitter`.**
`SparkJobSubmitter` already captures `ex.getMessage` for the cache entry. The same string is written
to `error_log`. No log aggregation or truncation in this iteration.

**D4 — `rowCount` is derived from `collectRows` result length in `SparkJobSubmitter`.**
`collectRows` returns a `Seq` — `.size` is O(1). No schema changes needed to the cache entry;
`rowCount` is only persisted to `pipeline_runs`, not added to the in-memory `RunEntry`.

**D5 — Frontend `runHistory` lives in `pipelinesSlice`, keyed by pipeline ID.**
`runHistory: Record<string, PipelineRunRecord[]>` avoids a separate slice. The `fetchPipelineRunHistory`
thunk is dispatched on `PipelineDetailPage` mount (after the pipeline ID is known), matching the
pattern used for `fetchSources`.

**D6 — History panel is a collapsible section below the footer, not a tab.**
`PipelineDetailPage` has no tab infrastructure. A collapsible `<details>` element is the simplest
addition that keeps the footer layout unchanged.

## Risks / Trade-offs

- [Large error logs could bloat `pipeline_runs`] → Accepted for now; truncation is a follow-up.
- [deleteOldRuns races with concurrent submissions] → Benign: at most 11 rows briefly per pipeline.
- [History loaded on mount adds a request per page open] → Acceptable; history is small (≤ 10 rows).

## Planner Notes

Self-approved: one new DB table (no breaking schema changes), one new GET endpoint (additive),
no new external dependencies, no architectural pattern changes.
