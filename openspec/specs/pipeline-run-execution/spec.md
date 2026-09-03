# pipeline-run-execution Specification

## Purpose
TBD - created by archiving change pipeline-step-execution. Update Purpose after archive.

## Requirements

### Requirement: POST /api/pipelines/:id/run executes steps and returns a result
The run endpoint SHALL execute the pipeline's graph and return a result reporting per-node row counts for **every** evaluated node across **all** lanes, keyed by node id. When a step fails, the reported error SHALL identify the failing step and its reason, and SHALL additionally identify the **lane path** leading to that step, so a failure in one of several sibling lanes is unambiguous. The lane path SHALL be the ordered list of step ids from the source root to the failing step inclusive, joined by `" > "`, with the virtual root rendered as `root` (for example `root > s1 > s4 > s7`).

#### Scenario: Row counts are returned for nodes in every lane
- **WHEN** a pipeline with two sibling lanes is run
- **THEN** the result carries a row count for every evaluated node in both lanes

#### Scenario: A failure in the second of two lanes names that lane's path
- **WHEN** a step in the second of two sibling lanes raises during a run
- **THEN** the result names the failing step, its reason, and the lane path leading to it, in the specified format

#### Scenario: A failure in a non-branching pipeline is unchanged in substance
- **WHEN** a step fails in a pipeline with no branching
- **THEN** the failing step and its reason are reported as before, with the lane path being the single chain to that step

#### Scenario: Run with no steps returns source rows unchanged
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline that has no steps
- **THEN** the response is `200 OK` with all source rows returned and `last_run_status` is `"succeeded"`

#### Scenario: Run with multiple steps applies them in position order
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose trunk has steps at positions
  0, 1, 2 (a pure trunk, no tails)
- **THEN** the response is `200 OK` with rows that reflect the cumulative output of all three steps
  applied in trunk order — identical to what the pre-tree-walk engine produced for the same pipeline

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

#### Scenario: Step failure names the step id, kind, and reason
- **GIVEN** a pipeline whose second step is a `stringops` step configured with an unsupported `operation`
- **WHEN** `POST /api/pipelines/:id/run` is called
- **THEN** the response is `422 Unprocessable Entity`
- **AND** the error message contains that step's id, the string `stringops`, and the underlying
  validation message naming the unsupported value and the supported operations

#### Scenario: A non-validation failure does not leak internals
- **GIVEN** a step that fails with a throwable that is not an `IllegalArgumentException`
- **WHEN** the pipeline is run
- **THEN** the error message names the failing step's id and kind
- **AND** the message contains neither the throwable's message nor any package-qualified class name

#### Scenario: A step-tree invariant violation is rejected before execution
- **WHEN** `POST /api/pipelines/:id/run` is called for a pipeline whose step tree violates the
  Phase-1 graph invariant (see `pipeline-step-tree`)
- **THEN** the response is `422 Unprocessable Entity` naming the offending node, and no step is
  evaluated

### Requirement: POST /api/pipelines/:id/run?dry=true returns preview rows without side effects
When the `dry=true` query parameter is present the backend SHALL execute all pipeline steps against
the source data but SHALL NOT write to `node_snapshots` or any Output's `schema` field, and SHALL NOT
update `last_run_status` or `last_run_at`. The response SHALL be `200 OK` with
`{ rows: [...], rowCount: N }` reflecting the trunk's terminal frame (per-node preview data is
available engine-internally via `PipelineExecutionOutcome.nodeOutcomes`, per `pipeline-execution`,
but this HTTP response shape is unchanged by this ticket — exposing per-Output preview data over HTTP
is P1.3/HEL-906's job).

#### Scenario: Dry run returns rows without updating last_run_status
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called
- **THEN** the response is `200 OK` with rows and `last_run_status` in the database remains unchanged

#### Scenario: Dry run does not write to the Type Registry
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called successfully
- **THEN** every materialized node's `node_snapshots` rows and every Output's `schema` are
  unchanged after the call (the retired Type Registry `fields`/`version` fields this scenario
  originally described no longer exist, per HEL-904)

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
The execution engine SHALL support the `join` op with inner and left join semantics. The config SHALL contain `secondaryInput` (the discriminated object, exactly one of `{"kind": "source", "dataSourceId": "<id>"}` or `{"kind": "lane", "stepId": "<id>"}`), `joinKey` (a column present in both inputs), and `joinType` (`"inner"` or `"left"`). The legacy flat `rightDataSourceId` field SHALL NOT be accepted. The result SHALL contain all columns from both inputs (right-side duplicate key column excluded), identically whether the right-hand rows come from a data source or from a referenced lane node's post-evaluation frame.

#### Scenario: Inner join returns only matching rows
- **WHEN** a `join` step with `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "joinType": "inner"}` is executed
- **THEN** only rows matching on `joinKey` are returned, with all columns from both sides and the right-side duplicate key column excluded

#### Scenario: Left join preserves unmatched left rows
- **WHEN** the same step is executed with `"joinType": "left"`
- **THEN** unmatched left rows are preserved with null-filled right-side columns

#### Scenario: A lane-kind join produces the same shape
- **WHEN** a `join` step's right-hand rows come from a `lane`-kind secondary input instead of a data source
- **THEN** the joined result has the same columns and semantics as the equivalent source-kind join

#### Scenario: Left join retains all left rows
- **WHEN** a join step with `joinType: "left"` is applied and some left-side rows have no match
- **THEN** all left-side rows appear in the result with null values for right-side columns where no match exists

### Requirement: Successful non-dry run writes schema snapshot to Type Registry
After a successful non-dry run, for every **materialized node** (a node with >= 1 Output attached, per
`outputs-model`), the backend SHALL replace that node's `node_snapshots` rows with the run's result
for that node, and derive each attached Output's `schema` field via shallow union inference over that
node's full row set (see `pipeline-execution`), UNLESS the run is blocked by an error-severity
assertion failure (see `pipeline-assert-fail-policy`), in which case no materialized node's snapshot
or schema SHALL be updated and each SHALL remain unchanged from before the run. This replaces the
pre-P1.2 mechanism of updating a single pipeline-wide `pipelines.output_data_type_id` Output's
`fields` from only the first result row and incrementing a `version` counter — that legacy Type
Registry / first-row-only inference mechanism no longer exists (removed by HEL-904/HEL-891); field
types are now derived from the complete per-node row set via shallow union inference, not from
runtime-value inspection of a single row.

(HEL-910 docs sweep: this requirement's own heading and the two scenario names below still read
"Type Registry" / "Output DataType" — that is stale vocabulary this sweep is closing out. Both the
mechanism and the retirement note above were already accurate; only the naming was lagging. The
heading is intentionally left unchanged in this MODIFIED delta so it continues to match the live
`openspec/specs/pipeline-run-execution/spec.md` requirement exactly for archival merge; a follow-up
rename would go through a dedicated `RENAMED Requirements` delta rather than being smuggled into a
same-cycle body edit.)

#### Scenario: Output DataType fields reflect run result schema
- **WHEN** `POST /api/pipelines/:id/run` succeeds against a materialized node whose result rows have
  columns `["name", "total"]`
- **THEN** that node's Output(s) `schema` contains fields for `name` and `total`, derived from the
  complete row set for that node, not only the first row
- (naming note: "DataType" here is legacy vocabulary for what this codebase now calls an Output's
  `schema` field — no `DataType` entity exists post-HEL-904/HEL-891)

#### Scenario: Output DataType version increments after run
- **WHEN** a non-dry run completes successfully against a materialized node
- **THEN** that node's Output(s) `schema` field is replaced wholesale with the newly-derived schema
- **AND** no `version` counter exists to increment — the retired Type Registry `version` field this
  scenario originally described no longer exists (removed by HEL-904)

#### Scenario: Numeric column inferred as integer type
- **WHEN** a non-dry run produces rows where a column holds only integral numeric values across the
  full row set for a materialized node
- **THEN** that node's Output field for that column has an `integer` type

#### Scenario: Floating-point column inferred as double type
- **WHEN** a non-dry run produces rows where a column holds at least one non-integral numeric value
  anywhere across the full row set for a materialized node
- **THEN** that node's Output field for that column has a `float` type

#### Scenario: Blocked run does not update the DataType schema or version
- **WHEN** a non-dry run's `assert` step has an error-severity rule that fails
- **THEN** every materialized node's `node_snapshots` rows and every Output's `schema` are
  byte-for-byte unchanged from before the run

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
The in-process execution engine SHALL support previewing only the path from the pipeline root to a
specified target step — the target step's own ancestor chain (trunk and/or the specific tail chain it
sits on), not a positional slice over a flat execution order. Callers are responsible for resolving
that path before invoking the engine. The engine SHALL NOT be aware of "partial" vs "full" execution
— path resolution happens in the route/service handler.

#### Scenario: Passing a subset of steps executes only those steps
- **WHEN** the engine is invoked with the resolved root-to-target-step path for a target step that is
  the second of three trunk steps (no tails involved)
- **THEN** only the first two (root-to-target-inclusive) steps are applied; the third trunk step is
  not applied

#### Scenario: Previewing a trunk step does not include an unrelated tail's steps
- **WHEN** a step is previewed that is downstream (on the trunk) of a node carrying a tail
- **THEN** the previewed prefix includes only that step's own trunk ancestor chain, never the
  unrelated tail's steps

#### Scenario: Previewing a tail step includes only its own chain
- **WHEN** a step on a tail is previewed
- **THEN** the previewed prefix is the path from the pipeline root, through the trunk up to the
  tail's attachment point, then down the tail to the target step — no sibling tail's steps, and no
  trunk steps beyond the attachment point

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
  `"succeeded"`, and the Output is populated with those rows

#### Scenario: A healthy sql source completes a real run
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose base source is a reachable
  `sql` source
- **THEN** the response is `200 OK` with rows fetched from the SQL query, `last_run_status` is
  `"succeeded"`, and the Output is populated with those rows

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
`Output` advertises. A nested object SHALL NOT be materialised as a raw JSON string under its top-level key.
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

### Requirement: The run result reports source-read truncation
The `POST /api/pipelines/:id/run` response body SHALL carry `sourceTruncated` (boolean),
`sourceAvailableRowCount` (number, present only when a total was actually observed) and
`truncationNotice` (string, present only when the read was truncated), in addition to the existing
`rows`, `rowCount`, `stepRowCounts` and `sourceRowCount` fields.

`sourceRowCount` SHALL retain its existing meaning — the number of rows actually read into the run —
and SHALL NOT be redefined to mean the available total.

The same fields SHALL be carried by the step-preview run result.

#### Scenario: Truncated run response
- **WHEN** a non-dry run reads 1000 of 3303 available rows
- **THEN** the `200 OK` body carries `sourceTruncated: true`, `sourceAvailableRowCount: 3303`,
  `sourceRowCount: 1000` and a non-empty `truncationNotice`

#### Scenario: Complete run response
- **WHEN** a non-dry run reads every row of its source
- **THEN** the body carries `sourceTruncated: false` and omits `truncationNotice`

#### Scenario: Truncation fields are backward compatible
- **WHEN** a client written before this change reads a run response
- **THEN** `rows`, `rowCount`, `stepRowCounts` and `sourceRowCount` are unchanged in name, type and meaning

### Requirement: The run engine re-fetches URL-backed CSV sources
When the pipeline engine reads a `csv` data source that carries a `sourceUrl`, it SHALL fetch that URL through the
same guarded fetch used at ingestion (https-only, address denylist, connection pinned to the validated address)
instead of reading the stored snapshot. A `csv` source with no `sourceUrl` SHALL read the stored snapshot exactly as
before. The fetch capability SHALL be supplied to the engine as an injectable seam so a run can be exercised in tests
without real network access, mirroring the existing REST connector override seam.

#### Scenario: A run over a URL-backed CSV reflects current upstream content
- **WHEN** a pipeline whose primary source is a URL-backed CSV is executed
- **THEN** the rows the engine produces come from a fresh fetch of `sourceUrl`, not from the stored snapshot

#### Scenario: A run over a snapshot-backed CSV is unchanged
- **WHEN** a pipeline whose primary source is an inline/upload-created CSV is executed
- **THEN** the engine reads the stored file and performs no fetch

#### Scenario: A failing fetch fails the run with a descriptive reason
- **WHEN** the engine's fetch of a URL-backed CSV fails the guard or the upstream returns non-2xx
- **THEN** the run fails and the failure names the data source and the reason, rather than silently producing zero rows
