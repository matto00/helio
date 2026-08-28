# pipeline-run-execution Specification

## Purpose
TBD - created by archiving change pipeline-step-execution. Update Purpose after archive.

## Requirements

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

### Requirement: POST /api/pipelines/:id/run?dry=true returns preview rows without side effects
When the `dry=true` query parameter is present the backend SHALL execute all pipeline steps against
the source data but SHALL NOT write results to the Type Registry and SHALL NOT update
`last_run_status` or `last_run_at`. The response SHALL be `200 OK` with
`{ rows: [...], rowCount: N }`.

#### Scenario: Dry run returns rows without updating last_run_status
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called
- **THEN** the response is `200 OK` with rows and `last_run_status` in the database remains unchanged

#### Scenario: Dry run does not write to the Type Registry
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called successfully
- **THEN** the output DataType's `fields` and `version` are unchanged after the call

### Requirement: Rename step renames one or more columns
The execution engine SHALL support the `rename` op. The step config SHALL contain a `mappings`
array of `{ from, to }` objects. Each mapping renames the `from` column to the `to` name in all
subsequent rows.

#### Scenario: Rename a single column
- **WHEN** a rename step with `mappings: [{ from: "a", to: "b" }]` is applied to rows that have column `a`
- **THEN** the result rows have column `b` with the same values, and column `a` is absent

### Requirement: Filter step removes rows not matching an expression
The execution engine SHALL support the `filter` op. The step config SHALL contain an `expression`
string (SQL-style boolean expression). Rows for which the expression evaluates to false SHALL be
excluded from the result.

#### Scenario: Filter keeps only matching rows
- **WHEN** a filter step with `expression: "age > 30"` is applied to rows where some rows have age ≤ 30
- **THEN** only rows with age > 30 are present in the result

### Requirement: Compute step adds or replaces a column with an expression value
The execution engine SHALL support the `compute` op. The config SHALL contain `column` (name of
column to write) and `expression` (SQL-style expression). The result SHALL contain the new or
updated column alongside all existing columns.

#### Scenario: Compute adds a derived column
- **WHEN** a compute step with `column: "total"` and `expression: "price * qty"` is applied
- **THEN** the result rows contain a `total` column equal to `price * qty` for each row

### Requirement: Group & aggregate step groups rows and applies an aggregation
The execution engine SHALL support the `groupby` op. The config SHALL contain `groupBy` (array of
column names), `aggColumn` (column to aggregate), and `aggFunction` (`"sum"` or `"count"`). The
result SHALL contain one row per unique group with the group key columns and an aggregated value
column named `<aggFunction>_<aggColumn>`.

#### Scenario: Groupby sum produces one row per group
- **WHEN** a groupby step with `groupBy: ["category"]`, `aggColumn: "amount"`, `aggFunction: "sum"` is applied
- **THEN** the result contains one row per unique `category` value with a `sum_amount` column

### Requirement: Cast step changes the data type of a column
The execution engine SHALL support the `cast` op. The config SHALL contain `column` (name) and
`dataType` (`"string"`, `"integer"`, `"long"`, `"double"`, `"boolean"`). Values SHALL be coerced
to the target type; rows where coercion fails SHALL use `null`.

#### Scenario: Cast string column to integer
- **WHEN** a cast step with `column: "qty"` and `dataType: "integer"` is applied to rows with string values like `"5"`
- **THEN** the result rows have `qty` as integer values

### Requirement: Join step merges two data sources on a key column
The execution engine SHALL support the `join` op with inner and left join semantics. The config
SHALL contain `rightDataSourceId` (id of the right-hand DataSource), `joinKey` (column present in
both sources), and `joinType` (`"inner"` or `"left"`). The result SHALL contain all columns from
both sources (right-side duplicate key column excluded).

#### Scenario: Inner join returns only matching rows
- **WHEN** a join step with `joinType: "inner"` is applied and some left-side rows have no match in the right source
- **THEN** only rows with a matching `joinKey` in both sources appear in the result

#### Scenario: Left join retains all left rows
- **WHEN** a join step with `joinType: "left"` is applied and some left-side rows have no match
- **THEN** all left-side rows appear in the result with null values for right-side columns where no match exists

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

### Requirement: Select step retains only specified columns during pipeline execution
The execution engine SHALL support the `select` op during pipeline runs. The step config SHALL
contain a `fields` array of column name strings. The engine SHALL retain only those columns in each
row and drop all others. Field names absent from a row SHALL be silently omitted.

#### Scenario: Select op applied during a pipeline run
- **WHEN** `POST /api/pipelines/:id/run` is called and the pipeline has a select step with `fields: ["id", "name"]`
- **THEN** the response rows contain only `id` and `name`; all other columns are absent

#### Scenario: Select with unknown field name does not error
- **WHEN** a select step references a field not present in any row and `POST /api/pipelines/:id/run` is called
- **THEN** the response is `200 OK` and the unknown field is silently absent from all result rows

### Requirement: Partial pipeline execution stops at a specified step
The in-process execution engine SHALL support running only a subset of steps (positions 0 through K
inclusive). The existing `execute` method signature remains unchanged. Callers are responsible for
passing only the relevant slice of steps. The engine SHALL NOT be aware of "partial" vs "full"
execution — slicing happens in the route handler.

#### Scenario: Passing a subset of steps executes only those steps
- **WHEN** the engine's `execute` method is called with steps at positions [0, 1] out of a
  pipeline that has steps at positions [0, 1, 2]
- **THEN** only the first two steps are applied; step 2 is not applied

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

### Requirement: POST /api/pipelines/:id/run executes a rest_api or sql base source
The backend SHALL execute a pipeline whose resolved base `sourceDataSourceId` is a `rest_api` or
`sql` `DataSource` using the in-process execution engine, the same way it already executes `static`/
`csv`/`text`/`pdf`/`image` sources — fetching rows via the source kind's existing connector
(`RestApiConnectorDriver`/`SqlConnectorDriver`) up to a bounded row count, then applying pipeline steps in
sequence. This SHALL NOT be rejected as an unsupported source type. A connector-level fetch failure
(unreachable endpoint, auth failure, query error) SHALL surface as the existing generic execution
failure (`422 Unprocessable Entity`, `last_run_status = "failed"`) — the same outcome any other
source-kind read failure already produces.

#### Scenario: A healthy rest_api source completes a real run
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose base source is a reachable
  `rest_api` source
- **THEN** the response is `200 OK` with rows fetched from the REST endpoint, `last_run_status` is
  `"succeeded"`, and the output DataType is populated with those rows

#### Scenario: A healthy sql source completes a real run
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose base source is a reachable
  `sql` source
- **THEN** the response is `200 OK` with rows fetched from the SQL query, `last_run_status` is
  `"succeeded"`, and the output DataType is populated with those rows

#### Scenario: An unreachable rest_api source fails the run, not silently
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose base `rest_api` source cannot
  be reached
- **THEN** the response is `422 Unprocessable Entity` and `last_run_status` is `"failed"` — the same
  outcome as any other source-kind read failure, not the categorical rejection this source kind
  previously always received

### Requirement: previewStep supports a rest_api or sql base source
`PipelineRunService.previewStep` SHALL support previewing a prefix of steps ending at a given step
id when the pipeline's base source is `rest_api` or `sql`, loading source rows the same way a full
run does (bounded, via the connector) before applying the requested step prefix. This SHALL NOT be
rejected as an unsupported source type.

#### Scenario: Previewing a step on a rest_api-sourced pipeline
- **WHEN** a step preview is requested for a pipeline whose base source is a reachable `rest_api`
  source
- **THEN** the response contains up to 10 preview rows reflecting the executed step prefix, not a
  422 "unsupported source type" error

### Requirement: Nested rest_api and sql rows materialise as dotted columns
When a pipeline's base source is a `rest_api` or `sql` source whose fetched rows contain nested JSON objects,
row materialisation SHALL expand those objects into dot-separated columns using the shared traversal defined
by the `nested-json-flattening` capability, so the executed rows carry the columns the source's registered
`DataType` advertises. A nested object SHALL NOT be materialised as a raw JSON string under its top-level key.
Rows containing no nested object SHALL be materialised exactly as before.

#### Scenario: Nested response row carries dotted columns
- **WHEN** a pipeline runs over a `rest_api` source returning `{"player_id": "8800", "stats": {"pts_ppr": 33.7}}`
- **THEN** the executed row has a `stats.pts_ppr` column holding `33.7`, and no `stats` column holding JSON text

#### Scenario: Key-addressed steps can reach a formerly unreachable nested field
- **WHEN** a `select` step lists the field `stats.pts_ppr` for such a source
- **THEN** the step retains that column instead of silently dropping it

#### Scenario: Flat rows are unaffected
- **WHEN** a pipeline runs over a `rest_api` or `sql` source whose rows contain no nested object
- **THEN** the executed rows are identical to those produced before this requirement existed

#### Scenario: Every registered snapshot field is a column the rows actually carry
- **WHEN** a non-dry run over a nested `rest_api` source writes its schema snapshot to the Type Registry
- **THEN** every field in the snapshot corresponds to a column present in at least one of the run's rows —
  no snapshot field is unreachable in the data
- **AND** the converse does not yet hold: a nested sub-key occurring only in a later sampled row may be absent
  from the snapshot, because cross-row merge keeps the first non-null value per top-level key. That residual
  is owned by HEL-858 and is deliberately out of scope here
