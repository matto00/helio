## MODIFIED Requirements

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
