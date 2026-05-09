## MODIFIED Requirements

### Requirement: Pipeline last-run fields are persisted on run completion
The backend SHALL update the pipeline row's `last_run_status` and `last_run_at` columns in the
`pipelines` table when an async Spark job reaches a terminal state (`succeeded` or `failed`).
`last_run_status` SHALL be set to `"succeeded"` or `"failed"` respectively. `last_run_at` SHALL
be set to the current UTC timestamp at the moment the terminal state is recorded.

#### Scenario: Succeeded run updates pipeline last_run_status to succeeded
- **WHEN** a Spark job completes successfully
- **THEN** the pipeline row's `last_run_status` is `"succeeded"` and `last_run_at` is a non-null timestamp

#### Scenario: Failed run updates pipeline last_run_status to failed
- **WHEN** a Spark job throws an exception during execution
- **THEN** the pipeline row's `last_run_status` is `"failed"` and `last_run_at` is a non-null timestamp

#### Scenario: Updated status is reflected in GET /api/pipelines list
- **WHEN** a pipeline run completes and `GET /api/pipelines` is called
- **THEN** the corresponding pipeline summary includes the updated `lastRunStatus` and `lastRunAt`
