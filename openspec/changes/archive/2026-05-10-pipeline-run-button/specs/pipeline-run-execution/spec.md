## ADDED Requirements

### Requirement: Non-dry run persists a pipeline_runs record
For a non-dry run (`dry` query parameter absent or not `"true"`), the backend SHALL insert a row
into `pipeline_runs` with `status = "queued"` before execution begins. After execution completes
the backend SHALL update that row to the terminal status (`"succeeded"` or `"failed"`), setting
`completed_at`, `row_count` (on success), and `error_log` (on failure). The backend SHALL then
delete all but the 10 most recent `pipeline_runs` rows for the pipeline. These side-effects SHALL
be skipped when `pipelineRunRepo` is unavailable (null-safe guard).

#### Scenario: Successful non-dry run creates a succeeded pipeline_runs record
- **WHEN** `POST /api/pipelines/:id/run` is called without `?dry=true` and execution succeeds
- **THEN** a `pipeline_runs` row exists with `status = "succeeded"`, `row_count` equal to the
  result row count, and `completed_at` set

#### Scenario: Failed non-dry run creates a failed pipeline_runs record
- **WHEN** `POST /api/pipelines/:id/run` is called without `?dry=true` and execution fails
- **THEN** a `pipeline_runs` row exists with `status = "failed"` and `error_log` containing
  the error message

#### Scenario: Dry run does not create a pipeline_runs record
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called and execution succeeds
- **THEN** no new row is inserted into `pipeline_runs`
