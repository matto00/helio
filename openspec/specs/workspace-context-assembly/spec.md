# workspace-context-assembly Specification

## Purpose
Provides a single server-side, owner-scoped snapshot of a caller's data sources, DataTypes, pipelines
(with per-step output columns), and dashboards via `GET /api/workspace/context`, so backend agent-grounding
paths (e.g. in-app NL authoring) don't need to fan out over individual REST endpoints or shell out to the
MCP process.
## Requirements
### Requirement: Workspace context endpoint
The system SHALL expose `GET /api/workspace/context`, mounted under the existing `WorkspaceRoutes`
`pathPrefix("workspace")`, returning a single JSON snapshot of the caller's data sources, DataTypes,
pipelines (with per-step output columns), and dashboards, structurally parallel to the MCP
`buildWorkspaceContext` `WorkspaceContext` interface (`helio-mcp/src/context.ts`), validating against
`schemas/workspace-context.schema.json`. The route SHALL accept an optional `budgetBytes` query
parameter (a non-negative integer) bounding the response's serialized size; when omitted, a
configured default budget applies.

#### Scenario: Authenticated caller fetches workspace context
- **WHEN** an authenticated user with at least one data source, DataType, pipeline, and dashboard
  calls `GET /api/workspace/context`
- **THEN** the response is `200` with a body containing `generatedAt`, `counts`, `dataSources`,
  `dataTypes`, `pipelines`, `dashboards`, `joinHints`, and `truncation`, matching
  `schemas/workspace-context.schema.json`

#### Scenario: Empty workspace returns empty collections, not an error
- **WHEN** an authenticated user with no data sources, DataTypes, pipelines, or dashboards calls
  `GET /api/workspace/context`
- **THEN** the response is `200` with `counts` all zero, every collection field an empty array, and
  `truncation.applied: false`

#### Scenario: Negative budgetBytes is rejected
- **WHEN** an authenticated user calls `GET /api/workspace/context?budgetBytes=-1`
- **THEN** the response is `400 Bad Request`

#### Scenario: budgetBytes of zero requests the smallest possible response
- **GIVEN** an authenticated user with at least one DataType carrying sample rows and column
  statistics
- **WHEN** that user calls `GET /api/workspace/context?budgetBytes=0`
- **THEN** the response is `200`, every `dataTypes[].sampleRows` is `[]`, every
  `dataTypes[].columnStats[*].exampleValues` is `[]`, `joinHints` is `[]`, and
  `truncation.structuralFloorExceedsBudget` is `true`

### Requirement: Owner-scoped assembly
Every resource collection in the workspace context SHALL be scoped to the caller exactly as the
underlying existing list method already scopes it (owner-only, `ctx.withUserContext`/`user.id`-filtered) —
the assembler SHALL NOT perform any direct database access beyond the existing
`DataSourceService`/`DataTypeRepository`/`PipelineService`/`DashboardService` methods.

#### Scenario: A caller never sees another user's resources
- **GIVEN** user A owns a data source, DataType, pipeline, and dashboard, and user B owns a distinct set
  of the same four resource kinds
- **WHEN** user B calls `GET /api/workspace/context`
- **THEN** the response's `dataSources`, `dataTypes`, `pipelines`, and `dashboards` contain only user B's
  resources, and `counts` reflects only user B's totals

### Requirement: Scoped PAT denial
A scoped Personal Access Token (`TokenScope`, HEL-369) SHALL NOT be able to read
`GET /api/workspace/context` — the request SHALL be rejected with `403 Forbidden`, inherited from
`AuthDirectives.confineScopedToken`'s existing non-`hooks`-segment denial.

#### Scenario: Scoped token is denied
- **GIVEN** a Personal Access Token scoped to a specific pipeline (`TokenScope`)
- **WHEN** that token is used to call `GET /api/workspace/context`
- **THEN** the response is `403 Forbidden`

### Requirement: DataType pipeline-output classification
Each entry in `dataTypes` SHALL set `pipelineOutput = true` if and only if the DataType's `sourceId` is
absent (a pipeline-produced, panel-bindable DataType); a DataType with a present `sourceId` (a
source-companion DataType) SHALL set `pipelineOutput = false`.

#### Scenario: Source-companion DataType is flagged non-bindable
- **GIVEN** a DataType created alongside a CSV data source (`sourceId` set)
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[]` entry has `pipelineOutput: false` and `sourceId` equal to the
  owning source's id

#### Scenario: Pipeline-output DataType is flagged bindable
- **GIVEN** a DataType produced by a pipeline run (`sourceId` absent)
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[]` entry has `pipelineOutput: true` and `sourceId: null`

### Requirement: Pipeline step output columns via analyze, with per-pipeline degradation
Each entry in `pipelines` SHALL include `steps`, populated by calling the existing pipeline analyze path
for that pipeline, with `outputColumns` listing each step's output schema field names. If analyze fails
for one pipeline, that pipeline's entry SHALL degrade to `steps: []` plus a `stepsError` message rather
than failing the whole `GET /api/workspace/context` request.

#### Scenario: Pipeline with steps reports output columns per step
- **GIVEN** a pipeline with two steps whose analyzed output schemas are `[a, b]` and `[a, b, c]`
- **WHEN** `GET /api/workspace/context` is called by that pipeline's owner
- **THEN** the corresponding `pipelines[].steps` entries report `outputColumns: ["a", "b"]` and
  `outputColumns: ["a", "b", "c"]` respectively, in step order

#### Scenario: One pipeline's analyze failure does not fail the whole request
- **GIVEN** a workspace with two pipelines, one of which fails to analyze (e.g. its source DataType was
  deleted)
- **WHEN** the owner calls `GET /api/workspace/context`
- **THEN** the response is still `200`, the failing pipeline's entry has `steps: []` and a non-empty
  `stepsError`, and the other pipeline's entry reports its steps normally

### Requirement: Bounded sample rows per pipeline-output DataType
Each `dataTypes[]` entry SHALL carry a `sampleRows` field: up to 5 rows read from the DataType's latest
pipeline-run snapshot, each row limited to the first 40 of the DataType's declared *Structured-category*
columns (in field order) — `Content`-category columns (`string-body`/`binary-ref`, HEL-217) SHALL be
excluded from `sampleRows` entirely — with any remaining cell value exceeding 200 characters truncated. A
DataType with no run snapshot, or a source-companion DataType (never written to the snapshot), SHALL
report `sampleRows: []`, never an error.

#### Scenario: Pipeline-output DataType with a run snapshot reports sample rows
- **GIVEN** a pipeline-output DataType whose producing pipeline has run successfully and written more
  than 5 rows to its snapshot
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[].sampleRows` contains exactly 5 rows, drawn from the snapshot in
  row order

#### Scenario: DataType with no run snapshot reports an empty array
- **GIVEN** a pipeline-output DataType whose pipeline has never run successfully
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[].sampleRows` is `[]`

#### Scenario: Source-companion DataType reports an empty array without a row query
- **GIVEN** a source-companion DataType (`sourceId` present)
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[].sampleRows` is `[]`

### Requirement: Sample-row size caps enforced by construction
Sample rows SHALL be bounded independently of workspace or DataType size: at most 5 rows (bounded at the
database query via `LIMIT`), at most the first 40 declared Structured-category columns per row, and at
most 200 characters per cell value (oversized values truncated to a `"…[truncated]"`-suffixed string),
regardless of how many rows, columns, or how large any individual stored value actually is. Content-
category column values SHALL be excluded from the database query itself (not fetched then discarded), so
that a Content field's stored size never affects the cost of assembling `sampleRows`.

#### Scenario: Oversized cell value is truncated
- **GIVEN** a DataType snapshot row containing a string value longer than 200 characters in a
  Structured-category column
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `sampleRows[].<column>` value is truncated to at most 200 characters plus
  the `"…[truncated]"` marker

#### Scenario: Wide DataType caps sample-row columns
- **GIVEN** a DataType with more than 40 declared Structured-category fields
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** each entry in the corresponding `dataTypes[].sampleRows` contains keys for at most the first
  40 of that DataType's declared Structured-category fields, in field order

#### Scenario: Content-category field value never appears in sample rows
- **GIVEN** a pipeline-output DataType with a `string-body` (or `binary-ref`) column whose stored value
  exceeds 200 characters
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** no entry in the corresponding `dataTypes[].sampleRows` contains a key for that column

### Requirement: Sample rows are owner-scoped
Sample rows SHALL only be readable by the DataType's owner, via the same ownership check
(`findByIdOwned`) the existing `GET /api/types/:id/rows` endpoint already performs — no new code path
bypasses this check.

#### Scenario: A caller never sees another user's sample rows
- **GIVEN** user A owns a pipeline-output DataType with a run snapshot, and user B owns a distinct
  pipeline-output DataType with its own run snapshot
- **WHEN** user B calls `GET /api/workspace/context`
- **THEN** the response's `dataTypes[]` entries contain only user B's own sample rows, never user A's

### Requirement: Bounded per-column statistics
Each `dataTypes[]` entry SHALL carry a `columnStats` field: an object keyed by column name, containing one
entry per Structured-category column of that DataType. Each entry SHALL report `nullRate` (fraction of
fetched rows whose value is JSON `null` or the key is absent), `distinctCount` (count of distinct values
among fetched rows, capped), `distinctCountCapped` (true iff the true distinct count among fetched rows
exceeds the cap), and `exampleValues` (up to 5 distinct, non-null example values). A column declared
`integer` or `float` SHALL additionally report `min`, `max`, and `mean` when at least one fetched value
parses as numeric.

#### Scenario: Structured column reports null rate, distinct count, and example values
- **GIVEN** a pipeline-output DataType with a `status` (string) column whose fetched snapshot rows contain
  a mix of `"active"`, `"inactive"`, and `null` values
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** `dataTypes[].columnStats.status` reports a `nullRate` between 0 and 1 reflecting the fraction of
  `null` values, a `distinctCount` of 2, `distinctCountCapped: false`, and `exampleValues` containing
  `"active"` and `"inactive"`

#### Scenario: Numeric column reports min, max, and mean
- **GIVEN** a pipeline-output DataType with an `amount` (float) column whose fetched snapshot rows contain
  the numeric values `10`, `20`, and `30`
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** `dataTypes[].columnStats.amount` reports `min: 10`, `max: 30`, and `mean: 20`

#### Scenario: Non-numeric column omits min, max, and mean
- **GIVEN** a pipeline-output DataType with a `status` (string) column
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** `dataTypes[].columnStats.status` has no `min`, `max`, or `mean` fields on the wire (absent, not
  `null`)

### Requirement: Column statistics computed over the same bounded fetch as sample rows
`columnStats` SHALL be computed from the same single, SQL-tier-`LIMIT`ed row fetch already made to derive
`sampleRows` for that DataType — no additional database query, and no query without a `LIMIT`. The shared
fetch's row bound SHALL be a fixed, documented constant, independent of the DataType's true row count.

#### Scenario: Column statistics for a DataType with more rows than the fetch bound
- **GIVEN** a pipeline-output DataType whose snapshot has more rows than the shared fetch's row bound
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the response is `200` and `columnStats` is present, computed only over the bounded row window,
  not the DataType's full row count

#### Scenario: Column statistics never trigger a second query per DataType
- **GIVEN** a workspace with pipeline-output DataTypes that have run snapshots
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** exactly one row-snapshot query is made per pipeline-output DataType (the same one that produces
  `sampleRows`), never two

### Requirement: Content-category columns excluded from column statistics
`columnStats` SHALL NOT contain an entry for a Content-category column (`string-body`/`binary-ref`,
HEL-217) — such a column's values SHALL be excluded from the underlying row fetch at the SQL tier, the same
mechanism `sampleRows` already uses, so a Content field's stored size never affects the cost of computing
`columnStats`.

#### Scenario: Content-category column has no columnStats entry
- **GIVEN** a pipeline-output DataType with a `string-body` column
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** `dataTypes[].columnStats` contains no key for that column

### Requirement: Numeric stats handle non-numeric values on a numeric-declared column
A column declared `integer` or `float` SHALL exclude, from its `min`/`max`/`mean` computation, any fetched
value that is JSON `null`, absent, or a string that does not parse as a number — without counting that
value as a numeric `0` and without affecting `nullRate` unless the value is actually `null`/absent. If no
fetched value for that column parses as numeric, `min`, `max`, and `mean` SHALL be absent on the wire.

#### Scenario: Numeric column with unparseable string values reports no min/max/mean
- **GIVEN** a pipeline-output DataType with an `amount` column declared `float`, whose fetched snapshot
  rows all hold the non-numeric string `"n/a"`
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** `dataTypes[].columnStats.amount` has no `min`, `max`, or `mean` fields, and `nullRate` is `0`
  (the values are present, just not numeric)

#### Scenario: Numeric column with string-encoded numbers still computes stats
- **GIVEN** a pipeline-output DataType with an `amount` column declared `integer`, whose fetched snapshot
  rows hold the JSON strings `"10"` and `"20"` (CSV-sourced data read as strings at runtime)
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** `dataTypes[].columnStats.amount` reports `min: 10`, `max: 20`, and `mean: 15`

### Requirement: Column statistics caps enforced by construction
`columnStats` computation SHALL be bounded independently of the DataType's data: the underlying row fetch
SHALL return values for at most the first 40 declared Structured-category columns per row (enforced at the
database query itself, not discarded after fetch — the same mechanism `sampleRows`'s Content-column
exclusion already uses), each value considered for `distinctCount`/`exampleValues` SHALL be truncated at
200 characters before use, `distinctCount` SHALL stop distinguishing beyond a fixed cap (reporting
`distinctCountCapped: true` past that point), and `exampleValues` SHALL contain at most 5 entries.

#### Scenario: High-cardinality column reports a capped distinct count
- **GIVEN** a pipeline-output DataType with an `id` column whose fetched snapshot rows are all distinct
  and exceed the distinct-count cap
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** `dataTypes[].columnStats.id` reports `distinctCountCapped: true` and `distinctCount` equal to
  the cap

#### Scenario: Wide DataType caps columnStats columns at the database query itself
- **GIVEN** a pipeline-output DataType with more than 40 declared Structured-category fields
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** `dataTypes[].columnStats` contains entries for at most the first 40 of that DataType's declared
  Structured-category fields, in field order, and the underlying row-snapshot query never returns values
  for the remaining fields

### Requirement: All-null and empty-snapshot columns handled gracefully
A column whose every fetched value is `null` or absent SHALL report `nullRate: 1`, `distinctCount: 0`,
`distinctCountCapped: false`, `exampleValues: []`, and no `min`/`max`/`mean`. A DataType with no run
snapshot (empty fetch) SHALL report every Structured-category column's `columnStats` entry with `nullRate:
0`, `distinctCount: 0`, `distinctCountCapped: false`, `exampleValues: []`, and no `min`/`max`/`mean`, rather
than omitting the entry or erroring.

#### Scenario: All-null column reports a full null rate and no min/max
- **GIVEN** a pipeline-output DataType with a `notes` column whose every fetched snapshot row has a `null`
  value
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** `dataTypes[].columnStats.notes` reports `nullRate: 1`, `distinctCount: 0`, and no `min`, `max`,
  or `mean`

#### Scenario: DataType with no run snapshot still reports columnStats entries
- **GIVEN** a pipeline-output DataType whose pipeline has never run successfully
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** `dataTypes[].columnStats` contains an entry for each of that DataType's Structured-category
  columns, each with `nullRate: 0` and `distinctCount: 0`

### Requirement: Column statistics are deterministic
Given the same underlying row snapshot, `columnStats` SHALL be identical across repeated calls: the same
`exampleValues` in the same order, and the same `mean` value (fixed rounding).

#### Scenario: Repeated calls produce identical column statistics
- **GIVEN** a pipeline-output DataType whose row snapshot has not changed
- **WHEN** `GET /api/workspace/context` is called twice in succession by that DataType's owner
- **THEN** both responses' `dataTypes[].columnStats` entries are identical, including `exampleValues`
  order and `mean` value

### Requirement: Column statistics are owner-scoped
`columnStats` SHALL only be computed from a row snapshot the caller owns, via the same ownership check
(`findByIdOwned`) the existing `GET /api/types/:id/rows` endpoint and `sampleRows` already perform — no new
code path bypasses this check.

#### Scenario: A caller never sees another user's column statistics
- **GIVEN** user A owns a pipeline-output DataType with a run snapshot, and user B owns a distinct
  pipeline-output DataType with its own run snapshot
- **WHEN** user B calls `GET /api/workspace/context`
- **THEN** the response's `dataTypes[]` entries contain only user B's own `columnStats`, never user A's

### Requirement: Deterministic column semantic role
Each `dataTypes[].columns[]` entry SHALL carry a `semanticRole` field, one of a fixed enum (`temporal`,
`dimension`, `measure`, `identifier`, `boolean`, `text`), derived from the column's declared `dataType`,
a deterministic name heuristic, and (when available) that column's `columnStats` entry — in a fixed,
documented precedence order. `semanticRole` is advisory: it SHALL NOT alter the column's authoritative
`dataType`.

#### Scenario: Declared boolean column is classified boolean
- **GIVEN** a pipeline-output DataType with an `is_active` column declared `boolean`
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `columns[]` entry for `is_active` reports `semanticRole: "boolean"`

#### Scenario: Declared timestamp column is classified temporal
- **GIVEN** a pipeline-output DataType with a `created_at` column declared `timestamp`
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `columns[]` entry for `created_at` reports `semanticRole: "temporal"`

#### Scenario: String column with a date-like name is classified temporal
- **GIVEN** a pipeline-output DataType with a `signup_date` column declared `string` (CSV-sourced)
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `columns[]` entry for `signup_date` reports `semanticRole: "temporal"`

#### Scenario: Id-named column is classified identifier regardless of declared type
- **GIVEN** a pipeline-output DataType with a `user_id` column declared `integer`, whose fetched snapshot
  values are all distinct and exceed the column-statistics distinct-count cap
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `columns[]` entry for `user_id` reports `semanticRole: "identifier"`

#### Scenario: Numeric non-id column is classified measure
- **GIVEN** a pipeline-output DataType with an `amount` column declared `float`
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `columns[]` entry for `amount` reports `semanticRole: "measure"`

#### Scenario: Low-cardinality string column is classified dimension
- **GIVEN** a pipeline-output DataType with a `status` column declared `string`, whose fetched snapshot
  rows hold only the values `"active"` and `"inactive"`
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `columns[]` entry for `status` reports `semanticRole: "dimension"`

#### Scenario: Content-category column is classified text without value inspection
- **GIVEN** a pipeline-output DataType with a `notes` column declared `string-body`
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `columns[]` entry for `notes` reports `semanticRole: "text"`

### Requirement: Bounded, precision-favoring join hints
The response SHALL carry a top-level `joinHints` array: cross-DataType pairs of `identifier`-role columns
(HEL-374, "Deterministic column semantic role") from the caller's own pipeline-output DataTypes, whose
normalized column name and declared-type bucket match, each reporting `leftDataTypeId`, `leftColumn`,
`rightDataTypeId`, `rightColumn`, and a `confidence` score in `[0.5, 1.0]`. Every hint SHALL be labelled
advisory/inferred; `joinHints` SHALL NOT be used to alter any DataType's declared schema. The candidate
search SHALL be bounded by construction (a documented cap on both per-bucket comparisons and total hints
returned), independent of workspace size. `confidence` SHALL combine value-overlap evidence with
cardinality evidence, so that a coincidental full overlap over a small, low-cardinality sample cannot by
itself produce a `confidence` at or near the top of the scale.

#### Scenario: A coincidental full overlap between low-cardinality columns does not report near-certain confidence
- **GIVEN** two pipeline-output DataTypes the caller owns with unrelated `identifier`-role columns whose
  example values are identical small integers and whose sampled distinct-value count is small on both
  sides
- **WHEN** `GET /api/workspace/context` is called by that caller
- **THEN** the resulting `joinHints` entry for that pair reports a `confidence` materially below the top
  of the `[0.5, 1.0]` scale, not `1.0`

#### Scenario: Matching identifier columns across two DataTypes produce a join hint
- **GIVEN** two pipeline-output DataTypes the caller owns, each with a `customer_id` column declared
  `integer`, with overlapping example values
- **WHEN** `GET /api/workspace/context` is called by that caller
- **THEN** `joinHints` contains one entry with `leftColumn: "customer_id"` and `rightColumn:
  "customer_id"` referencing the two DataTypes' ids, and `confidence` greater than `0.5`

#### Scenario: Non-identifier columns never produce a join hint
- **GIVEN** two pipeline-output DataTypes the caller owns, each with an `amount` column declared `float`
  with identical values
- **WHEN** `GET /api/workspace/context` is called by that caller
- **THEN** `joinHints` contains no entry referencing the `amount` columns

#### Scenario: Join hint search never compares across different callers' DataTypes
- **GIVEN** user A owns a pipeline-output DataType with an `order_id` identifier column, and user B owns a
  distinct pipeline-output DataType with an `order_id` identifier column of overlapping values
- **WHEN** user B calls `GET /api/workspace/context`
- **THEN** `joinHints` contains no entry referencing user A's DataType

#### Scenario: Join hint candidate search is bounded regardless of workspace size
- **GIVEN** a workspace with many pipeline-output DataTypes sharing a common identifier column name
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200` and `joinHints` contains at most the documented output cap of entries

#### Scenario: A wide DataType's join-hint candidates are bounded at the column-statistics cap
- **GIVEN** a pipeline-output DataType with more declared `_id`-suffixed Structured columns than the
  column-statistics column cap (40)
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** at most 40 of that DataType's columns are considered as join-hint candidates

### Requirement: Deterministic, priority-ordered budget trimming
The system SHALL shrink the response in a fixed, documented priority order when its serialized size
exceeds the effective budget (the `budgetBytes` query parameter, or the configured default when
omitted): first `sampleRows` row count (uniformly across all DataTypes), then
`columnStats[*].exampleValues` list length (uniformly across all columns), then `joinHints` count —
re-measuring after each tier, stopping as soon as the response fits. Structural fields (resource
identity, `columns[]`, `columnStats[*]`'s scalar fields, pipeline steps, dashboards) SHALL NEVER be
shrunk or omitted to meet the budget. Given the same input and the same budget, the trimmed output
SHALL be byte-identical across repeated calls.

#### Scenario: A response within budget is returned unchanged
- **GIVEN** a workspace whose assembled response, at its natural (untrimmed) size, is smaller than
  the effective budget
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200`, every DataType's `sampleRows` and `columnStats[*].exampleValues`
  are at their natural (untrimmed) size, `joinHints` is unchanged, and `truncation.applied` is
  `false`

#### Scenario: Sample rows shrink before example values
- **GIVEN** a workspace whose assembled response exceeds the effective budget, and which fits the
  budget once every DataType's `sampleRows` is reduced to fewer than its natural count while every
  column's `exampleValues` remains at its natural size
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200`, every DataType's `sampleRows` array has fewer entries than its
  natural count (uniformly, the same cap applied to every DataType), and every column's
  `exampleValues` array is unchanged from its natural size

#### Scenario: Example values shrink only once sample rows are fully exhausted
- **GIVEN** a workspace whose assembled response still exceeds the effective budget even with every
  DataType's `sampleRows` reduced to `[]`
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200`, every DataType's `sampleRows` is `[]`, and every column's
  `exampleValues` array has fewer than its natural 5 entries (uniformly capped)

#### Scenario: Join hints shrink only once sample rows and example values are fully exhausted
- **GIVEN** a workspace whose assembled response still exceeds the effective budget even with every
  DataType's `sampleRows` reduced to `[]` and every column's `exampleValues` reduced to `[]`
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200`, every DataType's `sampleRows` and every column's `exampleValues`
  are `[]`, and `joinHints` has fewer entries than it would have had at its natural (untrimmed)
  length

#### Scenario: Structural identity survives even the tightest budget
- **GIVEN** a workspace whose assembled response exceeds the effective budget even after `sampleRows`,
  `exampleValues`, and `joinHints` are all fully emptied
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200`, `counts` and every `dataSources[]`/`dataTypes[]`/`pipelines[]`/
  `dashboards[]` entry's identity and structural fields (id, name, `columns[]`, `columnStats[*]`'s
  `nullRate`/`distinctCount`/`distinctCountCapped`/`min`/`max`/`mean`, pipeline `steps[]`) are
  present and unchanged, and `truncation.structuralFloorExceedsBudget` is `true`

#### Scenario: Repeated calls with the same budget produce byte-identical trimmed output
- **GIVEN** a workspace whose underlying data has not changed and whose assembled response exceeds
  the effective budget
- **WHEN** `GET /api/workspace/context?budgetBytes=<N>` is called twice in succession by that
  workspace's owner, for the same `<N>`
- **THEN** both responses' bodies are byte-identical (aside from `generatedAt`)

### Requirement: Truncation is always reported, self-describing, and never silent
The response SHALL carry a `truncation` object, always present, reporting whether any value-level
trimming occurred, the effective `budgetBytes` used, the caps actually applied to `sampleRows` and
`exampleValues`, how many `joinHints` entries were dropped by budget trimming, and whether the
fully-trimmed structural floor still exceeds the budget. A consumer SHALL be able to determine from
`truncation` alone whether the response is a complete or partial view of the assembled context —
never by comparing field lengths itself.

#### Scenario: Untruncated response reports untouched caps
- **GIVEN** a workspace whose assembled response fits within the effective budget without trimming
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** `truncation.applied` is `false`, `truncation.sampleRowsCap` and
  `truncation.exampleValuesCap` equal their natural (untrimmed) maximums, and
  `truncation.joinHintsOmittedByBudget` is `0`

#### Scenario: Truncated response reports the caps actually applied
- **GIVEN** a workspace whose assembled response required `sampleRows` trimming to fit the effective
  budget
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** `truncation.applied` is `true` and `truncation.sampleRowsCap` is less than the natural
  (untrimmed) `sampleRows` maximum

### Requirement: List-truncation past Page.Default is explicit, not silent
The response's `truncation.paginationTruncatedResources` array SHALL list a resource kind
(`dataSources`/`dataTypes`/`dashboards`, each fetched with `Page.Default`) by name whenever that
kind's fetched page contains fewer items than that kind's true total (`counts.*`). This SHALL NOT
change `Page.Default`'s value or add new-request pagination — it only makes the existing,
pre-existing truncation self-describing.

#### Scenario: A workspace with more than 200 DataTypes reports pagination truncation
- **GIVEN** a workspace with more than 200 DataTypes
- **WHEN** the owner calls `GET /api/workspace/context`
- **THEN** the response is `200`, `dataTypes.length` is at most 200, `counts.dataTypes` exceeds
  `dataTypes.length`, and `truncation.paginationTruncatedResources` contains `"dataTypes"`

#### Scenario: A workspace within the page limit reports no pagination truncation
- **GIVEN** a workspace with fewer than 200 DataTypes, data sources, and dashboards
- **WHEN** the owner calls `GET /api/workspace/context`
- **THEN** `truncation.paginationTruncatedResources` is `[]`

### Requirement: Budget is configurable with a backward-compatible default
The default budget (applied when `budgetBytes` is omitted) SHALL be overridable via environment
configuration, and SHALL be generous enough that an existing small workspace's response is
unaffected by this change (`truncation.applied: false`).

#### Scenario: Small workspace is unaffected by the default budget
- **GIVEN** a workspace with a small number of DataTypes, each with a small number of sample rows
  and columns
- **WHEN** the owner calls `GET /api/workspace/context` with no `budgetBytes` param
- **THEN** the response is `200` and `truncation.applied` is `false`

