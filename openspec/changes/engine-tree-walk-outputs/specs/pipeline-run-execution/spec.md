## MODIFIED Requirements

### Requirement: POST /api/pipelines/:id/run executes steps and returns a result
The backend SHALL expose `POST /api/pipelines/:id/run` that fetches the pipeline's steps as a tree
(trunk plus tails, per `pipeline-step-tree`), walks the trunk in order while evaluating each node's
tails from that node's own frame before advancing, applying each un-disabled step to an in-memory row
set loaded from the pipeline's source DataSource, and returns the trunk's terminal result. For
non-dry runs the response SHALL be `200 OK` with `{ rows: [...], rowCount: N }` regardless of whether
the run is subsequently blocked by an error-severity assertion failure (see
`pipeline-assert-fail-policy`) — step execution itself completed without exception, so the HTTP
response contract is unaffected by the fail-policy decision. `pipelines.last_run_status` SHALL be set
to `"succeeded"` and `pipelines.last_run_at` SHALL be set to the current timestamp on success, UNLESS
the run is blocked by an error-severity assertion failure, in which case `last_run_status` SHALL be
set to `"failed"` instead, exactly as it would be for a step execution failure. On step execution
failure the response SHALL be `422 Unprocessable Entity` with an error message, and `last_run_status`
SHALL be set to `"failed"`. A step tree violating the Phase-1 graph invariant (see
`pipeline-step-tree`) SHALL be rejected with `422 Unprocessable Entity` naming the offending node,
before any step evaluates.

When the failure originates inside a step of a run executed by the in-process pipeline engine, the error
message SHALL begin with the literal prefix
`Pipeline execution failed` and SHALL additionally name the failing step's id, the step's kind, and a
reason. The reason SHALL be the message of the underlying exception when and only when that exception is
an `IllegalArgumentException` — the type used by every step's own hand-written configuration validation.
For any other throwable the reason SHALL be a fixed, non-descriptive string; the step id and kind SHALL
still be reported. The client-facing message SHALL NOT contain a stack trace, a package-qualified class
name, or any other internal detail. The full throwable SHALL continue to be logged server-side.

This message is used identically on all three client-visible surfaces it already reaches: the SSE
`errorLog` event, `RunStatusResponse.error`, and the persisted `PipelineRunRecord.errorLog`. Step preview
(`previewStep`) SHALL report failures the same way.

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

#### Scenario: Output DataType fields reflect run result schema
- **WHEN** `POST /api/pipelines/:id/run` succeeds against a materialized node whose result rows have
  columns `["name", "total"]`
- **THEN** that node's Output(s) `schema` contains fields for `name` and `total`, derived from the
  complete row set for that node, not only the first row

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
