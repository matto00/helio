## Purpose

Persists each pipeline run's per-step row counts and exposes the latest run's counts on the pipeline response, so the pipeline editor can show a row count after every step on a fresh page load.

## ADDED Requirements

### Requirement: Runs record per-step row counts
When a run writes its terminal result, the run's per-step row counts SHALL be stored on its `pipeline_runs` row (`step_row_counts`, JSONB, step id to count) and on the pipeline (`last_run_step_row_counts`), under the same conditions as the existing row counts and in the same statement as each sibling: the run row's `row_count` and the pipeline's `last_run_row_count`. Every path that writes those counts as NULL (failed, write-back failed, blocked, pre-execution failure, Spark, the reaper) SHALL write the new columns as NULL too. A dry run's run row SHALL leave `step_row_counts` NULL, and a dry run SHALL NOT change `last_run_step_row_counts` (dry runs never update the pipeline's last-run fields). Rows written before this change keep NULL (not recorded); no backfill.

#### Scenario: Succeeded run records counts
- **WHEN** a 3-step pipeline run succeeds
- **THEN** its run row and the pipeline both hold a count for each of the 3 steps

#### Scenario: Failed run clears the pipeline's counts
- **WHEN** the latest run of a pipeline fails or is reaped
- **THEN** `last_run_step_row_counts` is NULL, like `last_run_row_count`

### Requirement: The pipeline response exposes the latest run's per-step counts
The pipeline response SHALL include `lastRunStepRowCounts` (an object of step id to count, or null when not recorded), documented in the pipeline JSON schema.

#### Scenario: Never-run pipeline
- **WHEN** a pipeline that has never run is fetched
- **THEN** `lastRunStepRowCounts` is null

### Requirement: Row-level security covers the new columns
Reads and writes of the new columns SHALL be governed by the existing `pipelines` and `pipeline_runs` policies, proven in a session without `BYPASSRLS`.

#### Scenario: Non-owner cannot read counts
- **WHEN** a user who neither owns nor has been granted the pipeline reads `pipeline_runs` in a non-BYPASSRLS session
- **THEN** no row and no counts are returned
