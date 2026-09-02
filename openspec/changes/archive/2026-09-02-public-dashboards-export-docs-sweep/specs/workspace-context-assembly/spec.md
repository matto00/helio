## MODIFIED Requirements

### Requirement: Bounded, precision-favoring join hints
The response SHALL carry a top-level `joinHints` array: cross-Output pairs of `identifier`-role columns
(HEL-374, "Deterministic column semantic role") from the caller's own pipeline-Outputs, whose
normalized column name and declared-type bucket match, each reporting `leftOutputId`, `leftColumn`,
`rightOutputId`, `rightColumn`, and a `confidence` score in `[0.5, 1.0]`. Every hint SHALL be labelled
advisory/inferred; `joinHints` SHALL NOT be used to alter any Output's declared schema. The candidate
search SHALL be bounded by construction (a documented cap on both per-bucket comparisons and total hints
returned), independent of workspace size. `confidence` SHALL combine value-overlap evidence with
cardinality evidence, so that a coincidental full overlap over a small, low-cardinality sample cannot by
itself produce a `confidence` at or near the top of the scale.

#### Scenario: A coincidental full overlap between low-cardinality columns does not report near-certain confidence
- **GIVEN** two pipeline-Outputs the caller owns with unrelated `identifier`-role columns whose
  example values are identical small integers and whose sampled distinct-value count is small on both
  sides
- **WHEN** `GET /api/workspace/context` is called by that caller
- **THEN** the resulting `joinHints` entry for that pair reports a `confidence` materially below the top
  of the `[0.5, 1.0]` scale, not `1.0`

#### Scenario: Matching identifier columns across two DataTypes produce a join hint
- **GIVEN** two pipeline-Outputs the caller owns, each with a `customer_id` column declared
  `integer`, with overlapping example values
- **WHEN** `GET /api/workspace/context` is called by that caller
- **THEN** `joinHints` contains one entry with `leftColumn: "customer_id"` and `rightColumn:
  "customer_id"` referencing the two Outputs' ids, and `confidence` greater than `0.5`

#### Scenario: Non-identifier columns never produce a join hint
- **GIVEN** two pipeline-Outputs the caller owns, each with an `amount` column declared `float`
  with identical values
- **WHEN** `GET /api/workspace/context` is called by that caller
- **THEN** `joinHints` contains no entry referencing the `amount` columns

#### Scenario: Join hint search never compares across different callers' DataTypes
- **GIVEN** user A owns a pipeline-Output with an `order_id` identifier column, and user B owns a
  distinct pipeline-Output with an `order_id` identifier column of overlapping values
- **WHEN** user B calls `GET /api/workspace/context`
- **THEN** `joinHints` contains no entry referencing user A's Output

#### Scenario: Join hint candidate search is bounded regardless of workspace size
- **GIVEN** a workspace with many pipeline-Outputs sharing a common identifier column name
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200` and `joinHints` contains at most the documented output cap of entries

#### Scenario: A wide DataType's join-hint candidates are bounded at the column-statistics cap
- **GIVEN** a pipeline-Output with more declared `_id`-suffixed Structured columns than the
  column-statistics column cap (40)
- **WHEN** `GET /api/workspace/context` is called by that Output's owner
- **THEN** at most 40 of that Output's columns are considered as join-hint candidates

