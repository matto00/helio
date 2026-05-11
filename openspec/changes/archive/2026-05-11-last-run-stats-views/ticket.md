# HEL-200 — Last-run timestamp and row count in list and detail views

## Description

Pipeline list and detail views show last-run timestamp, row count written, and status (succeeded/failed). Persisted on the pipeline record after each run. Panels sourced from the DataType display a "data as of [timestamp]" indicator.

## Acceptance Criteria

1. Pipeline list view displays, for each pipeline:
   - Last-run timestamp (relative, e.g. "2 hours ago") — or "Never run" if no runs exist
   - Last-run row count written (e.g. "1,234 rows") — omitted if never run
   - Last-run status badge (succeeded / failed) — omitted if never run

2. Pipeline detail view header/metadata section displays the same three fields with the same fallback text.

3. Dry runs do NOT count as the "last run" — only committed (non-dry) runs are considered.

4. Panels sourced from a DataType show a "data as of [timestamp]" indicator using the same last-run timestamp from the DataType's associated pipeline.

5. Backend: `PipelineSummary` (or equivalent list/detail response shape) is extended with:
   - `lastRunAt: Option[Instant]`
   - `lastRunStatus: Option[String]` (values: "succeeded" / "failed")
   - `lastRunRowCount: Option[Long]`
   These are populated by joining `pipeline_runs` to fetch the most-recent non-dry run per pipeline.

6. JSON schema for `PipelineSummary` is updated to include the three new optional fields.

7. Backend repository test covers the JOIN logic (pipeline with runs, pipeline with only dry runs, pipeline with no runs).

8. Frontend tests cover rendering with and without prior run data.
