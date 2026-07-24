# pipeline-window-op Specification

## Purpose
The `window` pipeline op computes per-partition ordered analytics — rank, row_number, dense_rank,
running_sum, lag, and lead — appending one derived column per row while preserving row count, and
defines the corresponding `analyze_pipeline` type inference so panels can bind to "rank within
category", "cumulative total over time", and top-N-per-group results.
## Requirements
### Requirement: Window op partitions, orders, and appends a derived column per row
The execution engine SHALL support the `window` op. The step config SHALL contain `partitionBy`
(`Vector[String]`: source column names to partition by), `orderBy` (`Vector[SortKey]`: the same
`field`/`direction` shape used by the `sort` op), `function` (`string`: one of `row_number`,
`rank`, `dense_rank`, `running_sum`, `lag`, `lead`), `field` (`Option[String]`: source column
required by `running_sum`/`lag`/`lead`, ignored by the rank family), `outputColumn` (`string`:
name of the appended column), and `offset` (`Option[Int]`: used by `lag`/`lead`, defaulting to
`1` when absent).

Rows SHALL be partitioned by the tuple of `partitionBy` field values (a `null` value at a
partition field is a valid partition key, mirroring the `aggregate` op's `groupBy` semantics and
the `pivot` op's `index` semantics). Within each partition, rows SHALL be ordered by `orderBy`
using the same comparator semantics as the `sort` op (numeric comparison when both sides coerce
to a number, else string comparison; nulls sort last in both directions), with ties broken by
each row's original position in the input (a stable tie-break, independent of whether the
underlying sort implementation is itself stable).

The op SHALL preserve row count and the *original input row order* in its output — computing the
window function over the partition-ordered view but emitting rows back in their original relative
order, appending `outputColumn` to each row with its computed value. If `outputColumn`'s name
collides with an existing field name on a row, the computed value SHALL overwrite it.

#### Scenario: Row_number assigns 1-based sequential positions per partition
- **WHEN** a `window` step runs with `function = "row_number"`, `partitionBy = ["category"]`,
  `orderBy = [{field: "amount", direction: "desc"}]`, `outputColumn = "rn"`
- **THEN** within each distinct `category` partition, rows are numbered 1, 2, 3, ... in descending
  `amount` order, and the output row order matches the original input row order

#### Scenario: Rank and dense_rank handle ties per standard SQL semantics
- **WHEN** two rows in the same partition have equal `orderBy` key values
- **THEN** `rank` assigns both rows the same rank and skips the next rank by the number of tied
  rows, while `dense_rank` assigns both rows the same rank and increments the next distinct value's
  rank by exactly 1

#### Scenario: Running_sum accumulates numeric values in partition order
- **WHEN** a `window` step runs with `function = "running_sum"`, `field = "amount"`
- **THEN** each row's `outputColumn` value is the cumulative sum of `amount` (coerced numerically,
  non-numeric or absent values contributing `0`, mirroring the `aggregate` op's `sum` coercion) up
  to and including that row's position in the partition's `orderBy` order

#### Scenario: Running_sum without a field fails with a descriptive error
- **WHEN** a `window` step runs with `function = "running_sum"` and `field` absent
- **THEN** step execution fails with a descriptive error stating `running_sum` requires `field`

#### Scenario: Lag and lead read a neighboring row's field value within the partition
- **WHEN** a `window` step runs with `function = "lag"`, `field = "amount"`, `offset = 1`
- **THEN** each row's `outputColumn` value is the raw (un-coerced) `amount` value of the row one
  position earlier in the partition's `orderBy` order; `lead` reads one position later

#### Scenario: Lag and lead at partition edges emit null
- **WHEN** a `window` step's `offset` would read past the first or last row of a partition (for
  `lag` or `lead` respectively)
- **THEN** the computed `outputColumn` value for that row is `null`

#### Scenario: Unsupported function fails at execute time
- **WHEN** a `window` step runs with a `function` value outside the six supported functions
- **THEN** step execution fails with a descriptive error naming the invalid value and listing the
  supported set

### Requirement: Analyze schema inference for window is statically determined
`analyze_pipeline` SHALL support the `window` op via an `inferWindow` case whose output schema is
the input schema plus `outputColumn`, with a type determined solely by `function` and the input
schema (no data sampling required): `integer` for `row_number`, `rank`, and `dense_rank`; `number`
for `running_sum`; the same declared type as `field`'s entry in the input schema for `lag` and
`lead` (falling back to `string` if `field` is not present in the input schema). If
`outputColumn`'s name collides with an existing input schema field, the inferred entry SHALL
replace it (matching the execution-time collision rule).

#### Scenario: Analyze appends outputColumn with function-appropriate type
- **WHEN** `analyze_pipeline` is called on a pipeline whose last step is `window` with
  `function = "rank"` and `outputColumn = "category_rank"`
- **THEN** the reported output schema is the input schema plus a `category_rank` field of type
  `integer`

#### Scenario: Analyze infers lag/lead output type from the source field
- **WHEN** `analyze_pipeline` is called on a `window` step with `function = "lag"`,
  `field = "amount"` where `amount` is typed `number` in the input schema
- **THEN** the reported `outputColumn` field is typed `number`

