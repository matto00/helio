# pipeline-list-api Specification

## Purpose
TBD - created by archiving change add-data-pipelines-list-view. Update Purpose after archive.

## Requirements

### Requirement: Backend pipelines table exists
The backend SHALL maintain a `pipelines` table with columns: `id` (UUID PK), `name` (text),
`source_data_source_id` (UUID FK to data_sources), `last_run_status` (nullable text, values:
`"succeeded"` or `"failed"`), `last_run_at` (nullable timestamptz), `created_at` (timestamptz),
`updated_at` (timestamptz). This table SHALL be created via a Flyway migration. The table SHALL
NOT reference `data_types` (dropped by HEL-904) — a pipeline's outputs are read via the `outputs`
table's `pipeline_id` FK, not a single `output_data_type_id` column.

`last_run_status` and `last_run_at` SHALL be written by the pipeline execution engine on every
non-dry run attempt: set to `"succeeded"` and the completion timestamp on success, or `"failed"`
and the failure timestamp on error. A run blocked by an error-severity assertion failure (see
`pipeline-assert-fail-policy`) SHALL also set `last_run_status` to `"failed"`, even though step
execution itself completed without exception — no third `last_run_status` value is introduced.

#### Scenario: Pipelines table is created on migration
- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipelines` table exists in the database with the specified columns and no
  `output_data_type_id` column

#### Scenario: last_run_status is updated to succeeded after a successful run
- **WHEN** a non-dry `POST /api/pipelines/:id/run` completes successfully
- **THEN** `pipelines.last_run_status` is `"succeeded"` and `last_run_at` is a recent timestamp

#### Scenario: last_run_status is updated to failed after a failed run
- **WHEN** a non-dry `POST /api/pipelines/:id/run` fails during step execution
- **THEN** `pipelines.last_run_status` is `"failed"` and `last_run_at` is a recent timestamp

#### Scenario: last_run_status is not updated on a dry run
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called
- **THEN** `pipelines.last_run_status` and `last_run_at` remain unchanged

#### Scenario: last_run_status is set to failed for a run blocked by an assertion failure
- **WHEN** a non-dry run completes step execution without exception, but an `assert` step's
  error-severity rule fails
- **THEN** `pipelines.last_run_status` is `"failed"` (not `"succeeded"`) and `last_run_at` is a
  recent timestamp

### Requirement: GET /api/pipelines returns pipeline summaries
The backend SHALL expose `GET /api/pipelines` that returns a JSON array of pipeline summary
objects. Each object SHALL include: `id`, `name`, `sourceDataSourceName`. `lastRunStatus`,
`lastRunAt`, and `lastRunRowCount` SHALL be present with their real values once a pipeline has run,
and SHALL be ABSENT from the response entirely (not present as `null`) for a pipeline that has
never run — `PipelineSummaryResponse`'s fields are `Option[...]` serialized via `jsonFormat9` with
no `NullOptions` mixed in, so spray-json omits a `None` field rather than writing `null`.
the retired `outputDataTypeName`/`output_data_type_id` fields are no longer included — a pipeline's Outputs are fetched
via `GET /api/pipelines/:id/outputs`.

#### Scenario: Returns empty array when no pipelines exist
- **WHEN** `GET /api/pipelines` is called and no pipelines exist
- **THEN** the response is `200 OK` with body `[]`

#### Scenario: Returns pipeline summaries with joined names
- **WHEN** one or more pipelines exist and `GET /api/pipelines` is called
- **THEN** the response is `200 OK` with an array where each item includes `sourceDataSourceName`
  from the joined data source and none of the retired `outputDataTypeName`/`output_data_type_id` fields

#### Scenario: Absent last-run fields for pipelines that have never run
- **WHEN** a pipeline has never been run
- **THEN** `lastRunStatus`, `lastRunAt`, and `lastRunRowCount` are all ABSENT from the response
  (not present as `null`)

#### Scenario: Non-null last-run fields for pipelines that have run
- **WHEN** a pipeline has a recorded last run
- **THEN** `lastRunStatus` is either `"succeeded"` or `"failed"`, `lastRunAt` is an ISO-8601
  timestamp, and `lastRunRowCount` is a non-negative integer
