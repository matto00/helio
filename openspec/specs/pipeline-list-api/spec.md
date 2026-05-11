# pipeline-list-api Specification

## Purpose
TBD - created by archiving change add-data-pipelines-list-view. Update Purpose after archive.
## Requirements
### Requirement: Backend pipelines table exists
The backend SHALL maintain a `pipelines` table with columns: `id` (UUID PK), `name` (text),
`source_data_source_id` (UUID FK to data_sources), `output_data_type_id` (UUID FK to data_types),
`last_run_status` (nullable text, values: `"succeeded"` or `"failed"`), `last_run_at` (nullable
timestamptz), `created_at` (timestamptz), `updated_at` (timestamptz). This table SHALL be created
via a Flyway migration.

`last_run_status` and `last_run_at` SHALL be written by the pipeline execution engine on every
non-dry run attempt: set to `"succeeded"` and the completion timestamp on success, or `"failed"`
and the failure timestamp on error.

#### Scenario: Pipelines table is created on migration
- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipelines` table exists in the database with the specified columns

#### Scenario: last_run_status is updated to succeeded after a successful run
- **WHEN** a non-dry `POST /api/pipelines/:id/run` completes successfully
- **THEN** `pipelines.last_run_status` is `"succeeded"` and `last_run_at` is a recent timestamp

#### Scenario: last_run_status is updated to failed after a failed run
- **WHEN** a non-dry `POST /api/pipelines/:id/run` fails during step execution
- **THEN** `pipelines.last_run_status` is `"failed"` and `last_run_at` is a recent timestamp

#### Scenario: last_run_status is not updated on a dry run
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called
- **THEN** `pipelines.last_run_status` and `last_run_at` remain unchanged

### Requirement: GET /api/pipelines returns pipeline summaries
The backend SHALL expose `GET /api/pipelines` that returns a JSON array of pipeline summary objects.
Each object SHALL include: `id`, `name`, `sourceDataSourceName`, `outputDataTypeName`,
`outputDataTypeId`, `lastRunStatus` (string or null), `lastRunAt` (ISO-8601 string or null),
and `lastRunRowCount` (number or null).

#### Scenario: Returns empty array when no pipelines exist
- **WHEN** `GET /api/pipelines` is called and no pipelines exist
- **THEN** the response is `200 OK` with body `[]`

#### Scenario: Returns pipeline summaries with joined names
- **WHEN** one or more pipelines exist and `GET /api/pipelines` is called
- **THEN** the response is `200 OK` with an array where each item includes `sourceDataSourceName`
  from the joined data source and `outputDataTypeName` from the joined data type

#### Scenario: Null last-run fields for pipelines that have never run
- **WHEN** a pipeline has never been run
- **THEN** `lastRunStatus`, `lastRunAt`, and `lastRunRowCount` are all `null` in the response

#### Scenario: Non-null last-run fields for pipelines that have run
- **WHEN** a pipeline has a recorded last run
- **THEN** `lastRunStatus` is either `"succeeded"` or `"failed"`, `lastRunAt` is an ISO-8601
  timestamp, and `lastRunRowCount` is a non-negative integer

