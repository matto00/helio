## ADDED Requirements

### Requirement: pipeline_runs table exists in the database
The backend SHALL maintain a `pipeline_runs` table created by Flyway migration V24 with columns:
`id` (TEXT PK), `pipeline_id` (TEXT FK → pipelines ON DELETE CASCADE), `started_at` (TIMESTAMPTZ NOT NULL),
`finished_at` (TIMESTAMPTZ nullable), `status` (TEXT NOT NULL — one of `queued`, `running`,
`succeeded`, `failed`), `row_count` (INT nullable), `error_log` (TEXT nullable). An index SHALL
exist on `pipeline_id`.

#### Scenario: pipeline_runs table is created on migration
- **WHEN** the backend starts and Flyway runs pending migrations
- **THEN** the `pipeline_runs` table exists with the specified columns, FK, and index

#### Scenario: Deleting a pipeline cascades to its runs
- **WHEN** a pipeline is deleted from the `pipelines` table
- **THEN** all associated rows in `pipeline_runs` are automatically deleted via ON DELETE CASCADE

### Requirement: Run is inserted into pipeline_runs when submitted
When `POST /api/pipelines/:id/run` submits a job, the backend SHALL insert a row into
`pipeline_runs` with `status: queued` and `started_at` set to the current time.

#### Scenario: Run row created on submission
- **WHEN** `POST /api/pipelines/:id/run` is called for a valid pipeline
- **THEN** a row exists in `pipeline_runs` with the returned `runId`, `status: queued`, and a non-null `started_at`

### Requirement: Run row updated on terminal state
When a Spark job reaches a terminal state (`succeeded` or `failed`), the backend SHALL update the
corresponding `pipeline_runs` row: set `status`, `finished_at` (current time), `row_count` (on
success), and `error_log` (on failure).

#### Scenario: Succeeded run row has row_count and finished_at
- **WHEN** the Spark job completes successfully
- **THEN** the `pipeline_runs` row has `status: succeeded`, a non-null `finished_at`, and a non-null `row_count`

#### Scenario: Failed run row has error_log and finished_at
- **WHEN** the Spark job throws an exception
- **THEN** the `pipeline_runs` row has `status: failed`, a non-null `finished_at`, and a non-null `error_log`

### Requirement: Only the last 10 runs per pipeline are retained
After each run insert, the backend SHALL delete the oldest runs beyond the 10 most recent for
that pipeline (ordered by `started_at`).

#### Scenario: 11th run trims the oldest
- **WHEN** a pipeline has 10 existing run records and a new run is inserted
- **THEN** the `pipeline_runs` table contains exactly 10 rows for that pipeline and the oldest row is removed

### Requirement: GET /api/pipelines/:id/run-history returns run records
The backend SHALL expose `GET /api/pipelines/:id/run-history` returning `200 OK` with a JSON
array of run objects ordered by `startedAt` DESC. Each object SHALL include: `id`, `pipelineId`,
`startedAt` (ISO-8601), `finishedAt` (ISO-8601 or null), `status`, `rowCount` (int or null),
`errorLog` (string or null).

#### Scenario: Returns empty array when no runs exist
- **WHEN** `GET /api/pipelines/:id/run-history` is called for a pipeline with no runs
- **THEN** the response is `200 OK` with body `[]`

#### Scenario: Returns runs ordered by startedAt descending
- **WHEN** a pipeline has multiple run records and `GET /api/pipelines/:id/run-history` is called
- **THEN** the response is `200 OK` with runs ordered most-recent-first

#### Scenario: Returns 404 for unknown pipeline
- **WHEN** `GET /api/pipelines/:id/run-history` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

### Requirement: Frontend fetches and renders run history in PipelineDetailPage
The `PipelineDetailPage` SHALL dispatch `fetchPipelineRunHistory` on mount and render a
collapsible run history panel. Each row in the panel SHALL display: start time, duration
(computed as `finishedAt - startedAt`, or "In progress" if null), row count (or "—" if null),
and a status badge. Failed rows SHALL be expandable to show `errorLog`.

#### Scenario: Run history panel renders fetched records
- **WHEN** `GET /api/pipelines/:id/run-history` returns a non-empty array
- **THEN** the run history panel displays one row per run with start time, duration, row count, and status

#### Scenario: Failed run row expands to show error log
- **WHEN** the user expands a failed run row
- **THEN** the `errorLog` text is visible

#### Scenario: Run history panel shows empty state when no runs
- **WHEN** `GET /api/pipelines/:id/run-history` returns an empty array
- **THEN** the run history panel displays a message indicating no runs have been recorded

#### Scenario: pipelinesSlice holds runHistory keyed by pipeline ID
- **WHEN** `fetchPipelineRunHistory` is dispatched for pipeline X
- **THEN** `state.pipelines.runHistory[X]` contains the fetched run records
