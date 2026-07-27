## ADDED Requirements

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
