## ADDED Requirements

### Requirement: pipelines table persists last_run_row_count
The `pipelines` table SHALL have a nullable `BIGINT` column `last_run_row_count`. This column
SHALL be written by `PipelineRepository.updateLastRun` alongside `last_run_status` and
`last_run_at` for every non-dry run attempt. Dry runs SHALL leave the column unchanged.

#### Scenario: last_run_row_count is set on successful non-dry run
- **WHEN** a non-dry `POST /api/pipelines/:id/run` completes successfully with N rows written
- **THEN** `pipelines.last_run_row_count` equals N

#### Scenario: last_run_row_count on failed non-dry run
- **WHEN** a non-dry `POST /api/pipelines/:id/run` fails during step execution
- **THEN** `pipelines.last_run_row_count` is set to `NULL` — no rows were committed, so the
  field reverts to the sentinel "no completed write" value. The implementation passes
  `rowCount = None` to `updateLastRun` on failure; `null` in the API response signals that the
  last committed run either never succeeded or has not yet run.

#### Scenario: last_run_row_count is not updated on dry run
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called
- **THEN** `pipelines.last_run_row_count` remains unchanged

#### Scenario: last_run_row_count is null for a pipeline that has never run
- **WHEN** a pipeline row is first created
- **THEN** `last_run_row_count` is NULL

### Requirement: PipelineSummary includes lastRunRowCount
`PipelineSummary` (both the backend DTO and the Scala `PipelineSummaryResponse`) SHALL include
`lastRunRowCount: Option[Long]`. The field SHALL be populated from `pipelines.last_run_row_count`.
The JSON key SHALL be `lastRunRowCount`; value is a number or `null`.

#### Scenario: GET /api/pipelines includes lastRunRowCount when set
- **WHEN** a pipeline has run and `last_run_row_count` is non-null
- **THEN** the response object for that pipeline includes `"lastRunRowCount": <number>`

#### Scenario: GET /api/pipelines returns null lastRunRowCount for never-run pipeline
- **WHEN** a pipeline has never run
- **THEN** the response object includes `"lastRunRowCount": null`
