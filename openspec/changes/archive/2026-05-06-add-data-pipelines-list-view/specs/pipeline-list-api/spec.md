## ADDED Requirements

### Requirement: Backend pipelines table exists
The backend SHALL maintain a `pipelines` table with columns: `id` (UUID PK), `name` (text), `source_data_source_id` (UUID FK to data_sources), `output_data_type_id` (UUID FK to data_types), `last_run_status` (nullable text, values: "succeeded" or "failed"), `last_run_at` (nullable timestamptz), `created_at` (timestamptz), `updated_at` (timestamptz). This table SHALL be created via a Flyway migration.

#### Scenario: Pipelines table is created on migration
- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipelines` table exists in the database with the specified columns

### Requirement: GET /api/pipelines returns pipeline summaries
The backend SHALL expose `GET /api/pipelines` that returns a JSON array of pipeline summary objects. Each object SHALL include: `id`, `name`, `sourceDataSourceName`, `outputDataTypeName`, `lastRunStatus` (string or null), `lastRunAt` (ISO-8601 string or null).

#### Scenario: Returns empty array when no pipelines exist
- **WHEN** `GET /api/pipelines` is called and no pipelines exist
- **THEN** the response is `200 OK` with body `[]`

#### Scenario: Returns pipeline summaries with joined names
- **WHEN** one or more pipelines exist and `GET /api/pipelines` is called
- **THEN** the response is `200 OK` with an array where each item includes `sourceDataSourceName` from the joined data source and `outputDataTypeName` from the joined data type

#### Scenario: Null last-run fields for pipelines that have never run
- **WHEN** a pipeline has never been run
- **THEN** `lastRunStatus` and `lastRunAt` are both `null` in the response

#### Scenario: Non-null last-run fields for pipelines that have run
- **WHEN** a pipeline has a recorded last run
- **THEN** `lastRunStatus` is either `"succeeded"` or `"failed"` and `lastRunAt` is an ISO-8601 timestamp
