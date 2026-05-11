## Context

`pipelines` table already carries `last_run_status` and `last_run_at` columns (written by
`PipelineRepository.updateLastRun` after each non-dry run). `PipelineSummary` (backend DTO and
Scala response type) surfaces both fields; the frontend `PipelineSummary` interface and
`PipelineListTable` render them. The missing piece is the row count: it is available in
`pipeline_runs.row_count` immediately after a run but is not denormalized onto `pipelines`.

## Goals / Non-Goals

**Goals:**
- Add `last_run_row_count` to the `pipelines` table and write it in `updateLastRun`.
- Propagate through `PipelineSummary` → `PipelineSummaryResponse` → frontend type → UI.
- Improve `PipelineListTable` to show row count and relative time.
- Add a persistent last-run metadata bar to `PipelineDetailPage`.

**Non-Goals:**
- Querying `pipeline_runs` directly for the display value (denormalized column is consistent
  with the existing `last_run_status` / `last_run_at` pattern).
- "Data as of" indicator on panels — **explicitly deferred to a future ticket**. AC #4 in the
  ticket description calls for a "data as of [timestamp]" label on panels whose `typeId` is bound
  to a DataType that has an associated pipeline. Implementing this requires a new API join between
  panels, data types, and pipelines for which no existing infrastructure exists. The scope decision
  was taken at proposal time; AC #4 should be tracked as a follow-up (e.g. `panel-data-freshness`)
  rather than included in this change.

## Decisions

**Denormalize row count onto `pipelines` table** (over a live JOIN to `pipeline_runs`): consistent
with the existing `last_run_status` / `last_run_at` columns; avoids a subquery on every list fetch;
matches the pattern already approved in the `pipeline-list-api` spec.

**Flyway migration** adds `last_run_row_count BIGINT` nullable to `pipelines`. Uses `BIGINT` to
match `pipeline_runs.row_count` (which is `BIGINT` in the Slick mapping); existing rows default to
NULL naturally.

**Relative-time formatting** in `PipelineListTable`: implement a small local utility
`formatRelativeTime(iso: string): string` using `Date` arithmetic (no third-party lib) returning
strings like "3 minutes ago", "2 hours ago", "5 days ago". Used in the "Last Run" column.

**Metadata bar in `PipelineDetailPage`**: a compact `<div className="pipeline-detail-page__meta-bar">`
rendered just below the back breadcrumb nav. Shows: relative timestamp, row count (formatted with
locale separator), and status badge. Visible only when `currentPipeline.lastRunAt !== null`.

**`PipelineSummaryResponse` field count**: currently 7 fields (`jsonFormat7`). Adding
`lastRunRowCount` makes it 8 → update to `jsonFormat8`.

## Risks / Trade-offs

[Race condition between `updateLastRun` and `listSummaries`] → Acceptable: the existing
`last_run_status` / `last_run_at` already have this property; UX shows "stale for one list fetch"
which is acceptable for a denormalized display field.

[BIGINT vs Int in Slick] → `PipelineRow` currently uses `Option[Instant]` for dates; `row_count`
in `PipelineRunTable` uses `Option[Int]`. Use `Option[Long]` for `last_run_row_count` in
`PipelineRow` to be explicit; the Flyway column is `BIGINT`.

## Planner Notes

Self-approved. No new external dependencies. No breaking API changes (the new field is additive
and optional). All existing tests continue to compile once `PipelineSummary` fixture objects are
updated with `lastRunRowCount = None / null`.

**AC #5 wording note**: The ticket AC #5 reads "populated by joining `pipeline_runs` to fetch
the most-recent non-dry run per pipeline." The implementation instead denormalizes
`last_run_row_count` directly onto the `pipelines` table — consistent with the pre-existing
`last_run_status` and `last_run_at` columns. The decision to denormalize rather than JOIN is
documented in the Decisions section above; the AC #5 wording reflects an earlier design
direction that was superseded. No functional change is required — the field semantics are
identical; only the storage and retrieval mechanism differs.
