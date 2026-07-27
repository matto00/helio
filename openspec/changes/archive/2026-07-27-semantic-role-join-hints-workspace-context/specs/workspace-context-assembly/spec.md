## ADDED Requirements

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
