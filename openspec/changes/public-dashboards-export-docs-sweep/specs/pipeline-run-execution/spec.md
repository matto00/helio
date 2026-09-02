## MODIFIED Requirements

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
