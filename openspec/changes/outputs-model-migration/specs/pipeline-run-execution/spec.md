## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

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
- **THEN** the Output's `fields` and `version` are unchanged after the call

### Requirement: Successful non-dry run writes schema snapshot to Type Registry
After a successful non-dry run the backend SHALL update the node snapshot / Output
(`pipelines.output_data_type_id`) with the inferred field schema derived from the result row keys,
UNLESS the run is blocked by an error-severity assertion failure (see `pipeline-assert-fail-policy`), in
which case the Output/node record SHALL NOT be updated and its previously-persisted schema SHALL remain
unchanged. When the update does occur, field types SHALL be inferred from the actual runtime values in
the first result row: `Boolean` values → `"boolean"`, integer/long values → `"integer"`, float/double
values → `"double"`, all other values → `"string"`. The Output/node's `version` SHALL be incremented.

#### Scenario: Output DataType fields reflect run result schema
- **WHEN** `POST /api/pipelines/:id/run` succeeds and the result has columns `["name", "total"]`
- **THEN** the Output's `fields` contain entries for `name` and `total` with `dataType: "string"`

#### Scenario: Output DataType version increments after run
- **WHEN** a non-dry run completes successfully
- **THEN** the Output's `version` is one higher than before the run

#### Scenario: Numeric column inferred as integer type
- **WHEN** a non-dry run produces rows where a column's first-row value is an Int or Long
- **THEN** the Output's field for that column has `dataType: "integer"`

#### Scenario: Floating-point column inferred as double type
- **WHEN** a non-dry run produces rows where a column's first-row value is a Float or Double
- **THEN** the Output's field for that column has `dataType: "double"`

#### Scenario: Blocked run does not update the DataType schema or version
- **WHEN** a non-dry run's `assert` step has an error-severity rule that fails
- **THEN** the Output's `fields` and `version` are byte-for-byte unchanged from before the run

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

### Requirement: Nested rest_api and sql rows materialise as dotted columns
When a pipeline's base source is a `rest_api` or `sql` source whose fetched rows contain nested JSON objects,
row materialisation SHALL expand those objects into dot-separated columns using the shared traversal defined
by the `nested-json-flattening` capability, so the executed rows carry the columns the source's registered
`Output/node` advertises. A nested object SHALL NOT be materialised as a raw JSON string under its top-level key.
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
