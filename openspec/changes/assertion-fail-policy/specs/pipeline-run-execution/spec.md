## MODIFIED Requirements

### Requirement: POST /api/pipelines/:id/run executes steps and returns a result
The backend SHALL expose `POST /api/pipelines/:id/run` that fetches the pipeline's steps ordered
ascending by `position`, applies each step in sequence to an in-memory row set loaded from the
pipeline's source DataSource, and returns the result. For non-dry runs the response SHALL be
`200 OK` with `{ rows: [...], rowCount: N }` regardless of whether the run is subsequently blocked by
an error-severity assertion failure (see `pipeline-assert-fail-policy`) — step execution itself
completed without exception, so the HTTP response contract is unaffected by the fail-policy decision.
`pipelines.last_run_status` SHALL be set to `"succeeded"` and `pipelines.last_run_at` SHALL be set to
the current timestamp on success, UNLESS the run is blocked by an error-severity assertion failure, in
which case `last_run_status` SHALL be set to `"failed"` instead, exactly as it would be for a step
execution failure. On step execution failure the response SHALL be `422 Unprocessable Entity` with an
error message, and `last_run_status` SHALL be set to `"failed"`.

#### Scenario: Run with no steps returns source rows unchanged
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline that has no steps
- **THEN** the response is `200 OK` with all source rows returned and `last_run_status` is `"succeeded"`

#### Scenario: Run with multiple steps applies them in position order
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline with steps at positions 0, 1, 2
- **THEN** the response is `200 OK` with rows that reflect the cumulative output of all three steps applied in order

#### Scenario: Run with an invalid step expression returns 422
- **WHEN** a filter step contains an invalid expression and `POST /api/pipelines/:id/run` is called
- **THEN** the response is `422 Unprocessable Entity` and `last_run_status` is `"failed"`

#### Scenario: Returns 404 for unknown pipeline
- **WHEN** `POST /api/pipelines/:id/run` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: Run blocked by an error-severity assertion still returns 200 OK, but last_run_status is failed
- **WHEN** `POST /api/pipelines/:id/run` is called and step execution completes without exception, but an
  `assert` step's error-severity rule fails
- **THEN** the HTTP response is still `200 OK` with the computed rows, but `pipelines.last_run_status` is
  set to `"failed"`, not `"succeeded"`

### Requirement: Successful non-dry run writes schema snapshot to Type Registry
After a successful non-dry run the backend SHALL update the output DataType record
(`pipelines.output_data_type_id`) with the inferred field schema derived from the result row keys,
UNLESS the run is blocked by an error-severity assertion failure (see `pipeline-assert-fail-policy`), in
which case the DataType record SHALL NOT be updated and its previously-persisted schema SHALL remain
unchanged. When the update does occur, field types SHALL be inferred from the actual runtime values in
the first result row: `Boolean` values → `"boolean"`, integer/long values → `"integer"`, float/double
values → `"double"`, all other values → `"string"`. The DataType's `version` SHALL be incremented.

#### Scenario: Output DataType fields reflect run result schema
- **WHEN** `POST /api/pipelines/:id/run` succeeds and the result has columns `["name", "total"]`
- **THEN** the output DataType's `fields` contain entries for `name` and `total` with `dataType: "string"`

#### Scenario: Output DataType version increments after run
- **WHEN** a non-dry run completes successfully
- **THEN** the output DataType's `version` is one higher than before the run

#### Scenario: Numeric column inferred as integer type
- **WHEN** a non-dry run produces rows where a column's first-row value is an Int or Long
- **THEN** the output DataType's field for that column has `dataType: "integer"`

#### Scenario: Floating-point column inferred as double type
- **WHEN** a non-dry run produces rows where a column's first-row value is a Float or Double
- **THEN** the output DataType's field for that column has `dataType: "double"`

#### Scenario: Blocked run does not update the DataType schema or version
- **WHEN** a non-dry run's `assert` step has an error-severity rule that fails
- **THEN** the output DataType's `fields` and `version` are byte-for-byte unchanged from before the run

### Requirement: Non-dry run persists a pipeline_runs record
For a non-dry run (`dry` query parameter absent or not `"true"`), the backend SHALL insert a row
into `pipeline_runs` with `status = "queued"` before execution begins. After execution completes
the backend SHALL update that row to the terminal status (`"succeeded"` or `"failed"`), setting
`completed_at`, `row_count` (on success), and `error_log` (on failure). A run blocked by an
error-severity assertion failure (see `pipeline-assert-fail-policy`) SHALL also reach terminal status
`"failed"`, with `row_count` unset (`null`) and `error_log` set to a descriptive summary naming the
failing rule(s) — distinct from the generic message used for an unrelated execution exception. The
backend SHALL then delete all but the 10 most recent `pipeline_runs` rows for the pipeline. These
side-effects SHALL be skipped when `pipelineRunRepo` is unavailable (null-safe guard).

In addition, at each status transition the backend SHALL publish a `RunStatusEvent` to
`PipelineRunRegistry` for the pipeline: `queued` when pre-execution begins, `running` when the
engine starts, and `succeeded` or `failed` on completion (a blocked run publishes `failed`).

#### Scenario: Successful non-dry run creates a succeeded pipeline_runs record
- **WHEN** `POST /api/pipelines/:id/run` is called without `?dry=true` and execution succeeds
- **THEN** a `pipeline_runs` row exists with `status = "succeeded"`, `row_count` equal to the
  result row count, and `completed_at` set

#### Scenario: Failed non-dry run creates a failed pipeline_runs record
- **WHEN** `POST /api/pipelines/:id/run` is called without `?dry=true` and execution fails
- **THEN** a `pipeline_runs` row exists with `status = "failed"` and `error_log` containing
  the error message

#### Scenario: Dry run creates a pipeline_runs record with status dry_run
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called and execution succeeds
- **THEN** a `pipeline_runs` row is inserted with `status = "dry_run"`, `completed_at` set to the
  run start time, `row_count` equal to the result row count, and `error_log` null

#### Scenario: Failed dry run does not create a pipeline_runs record
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called and execution fails
- **THEN** no `pipeline_runs` row is inserted (the route returns 422 immediately without recording)

#### Scenario: SSE queued event published before engine starts
- **WHEN** `POST /api/pipelines/:id/run` is received and pre-execution work begins
- **THEN** a `queued` RunStatusEvent is published to PipelineRunRegistry before the engine is invoked

#### Scenario: SSE running event published when engine starts
- **WHEN** the in-process engine is about to be invoked for a run
- **THEN** a `running` RunStatusEvent is published to PipelineRunRegistry

#### Scenario: SSE succeeded event published on successful completion
- **WHEN** execution succeeds with N result rows and the run is not blocked by an assertion failure
- **THEN** a `succeeded` RunStatusEvent with `rowCount = N` is published to PipelineRunRegistry

#### Scenario: SSE failed event published on execution failure
- **WHEN** execution fails with an exception
- **THEN** a `failed` RunStatusEvent with the error message in `errorLog` is published to PipelineRunRegistry

#### Scenario: Blocked run persists a failed pipeline_runs record with a descriptive errorLog
- **WHEN** a non-dry run's `assert` step has an error-severity rule that fails
- **THEN** a `pipeline_runs` row exists with `status = "failed"`, `row_count` null, and `error_log`
  naming the failing rule's kind and field — not the generic execution-exception message
