## ADDED Requirements

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
