## MODIFIED Requirements

### Requirement: Window op partitions, orders, and appends a derived column per row
The execution engine SHALL support the `window` op. The step config SHALL contain `partitionBy`
(`Vector[String]`: source column names to partition by), `orderBy` (`Vector[SortKey]`: the same
`field`/`direction` shape used by the `sort` op), `function` (`string`: one of `row_number`,
`rank`, `dense_rank`, `running_sum`, `lag`, `lead`, `rolling_avg`, `rolling_sum`, `rolling_min`,
`rolling_max`, `rolling_count`), `field` (`Option[String]`: source column required by `running_sum`/`lag`/`lead`
and every `rolling_*` function, ignored by the rank family), `outputColumn` (`string`: name of the appended column),
`offset` (`Option[Int]`: used by `lag`/`lead`, defaulting to `1` when absent), `frameSize` (`Option[Int]`: the
rolling frame length, used by the `rolling_*` functions only) and `frameUnit` (`Option[String]`: `rows` or `days`,
used by the `rolling_*` functions only, defaulting to `rows` when absent). A config without `frameSize`/`frameUnit`
SHALL decode and behave exactly as before.

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
- **WHEN** a `window` step runs with a `function` value outside the eleven supported functions
- **THEN** step execution fails with a descriptive error naming the invalid value and listing the
  supported set

#### Scenario: A stored config without frame keys is unchanged
- **WHEN** a `window` step stored before this change (no `frameSize`, no `frameUnit`) is decoded and run
- **THEN** it produces exactly the output it produced before, and re-encoding it adds no frame keys

### Requirement: Analyze schema inference for window is statically determined
`analyze_pipeline` SHALL support the `window` op via an `inferWindow` case whose output schema is
the input schema plus `outputColumn`, with a type determined solely by `function` and the input
schema (no data sampling required): `integer` for `row_number`, `rank`, `dense_rank` and `rolling_count`;
`float` for `running_sum` (the type the code has emitted since HEL-895; this corrects the earlier `number` wording),
`rolling_avg`, `rolling_sum`, `rolling_min` and `rolling_max`; the same declared type as
`field`'s entry in the input schema for `lag` and `lead` (falling back to `string` if `field` is not present in the
input schema). If `outputColumn`'s name collides with an existing input schema field, the inferred entry SHALL
replace it (matching the execution-time collision rule). For every function, the type analyze infers SHALL be the
type of the values execution actually emits (a non-null `rolling_count` value is an integer, a non-null value of any
other rolling function is a floating-point number).

#### Scenario: Analyze appends outputColumn with function-appropriate type
- **WHEN** `analyze_pipeline` is called on a pipeline whose last step is `window` with
  `function = "rank"` and `outputColumn = "category_rank"`
- **THEN** the reported output schema is the input schema plus a `category_rank` field of type
  `integer`

#### Scenario: Analyze infers lag/lead output type from the source field
- **WHEN** `analyze_pipeline` is called on a `window` step with `function = "lag"`,
  `field = "amount"` where `amount` is typed `number` in the input schema
- **THEN** the reported `outputColumn` field is typed `number`

#### Scenario: Analyze infers rolling output types that match execution
- **WHEN** `analyze_pipeline` is called on a `window` step with `function = "rolling_avg"` (or `rolling_sum`,
  `rolling_min`, `rolling_max`), and separately with `function = "rolling_count"`
- **THEN** the reported `outputColumn` is typed `float` for the first four and `integer` for `rolling_count`, and
  running the same step emits values of exactly those types

### Requirement: Window config is validated at write time and a rejected save is shown on the offending control
A non-empty `function` outside the supported set, a `lag`/`lead` with an explicit `offset` <= 0, or a `rolling_*`
function with an explicit `frameSize` that is not an integer in 1..1000 (a fractional value, or one not representable as a
32-bit integer, SHALL be rejected, never dropped and stored as a draft), an explicit `frameUnit` other than `rows`/`days`, or
`frameUnit = "days"` with an `orderBy` that is non-empty but not exactly one ascending key (a key is ascending unless
its `direction` is `desc`, compared case-insensitively, matching the `sort` op), SHALL be rejected at write time. An empty `function`, a `running_sum`/`lag`/`lead`/`rolling_*` with no `field`, and a `rolling_*` with no
`frameSize` or an empty `orderBy`, are unconfigured drafts and SHALL stay saveable; analyze and execution still
report them. `frameSize`/`frameUnit` on a non-rolling function, like `offset` on a non-lag/lead function, SHALL be
ignored and not rejected. At run time the order of reported problems SHALL be: unsupported function, missing
`field`, missing `frameSize`, empty `orderBy`, then the write-time rule. In the editor, a rejected save SHALL be shown
as an inline error, the user's choice SHALL be kept, and the function control SHALL be marked invalid and described
by that error.

#### Scenario: Invalid window function or offset is rejected at write time
- **WHEN** a step create, step update, pipeline-proposal validate/apply or patch-set apply carries a window config with a non-empty unsupported `function`, or `lag`/`lead` with `offset` <= 0
- **THEN** the write is rejected with the existing step-config validation error response (e.g. 422 on REST) naming the problem, and nothing is persisted

#### Scenario: Invalid rolling frame is rejected at write time
- **WHEN** a write carries a `rolling_*` window config with `frameSize` 0, negative or above 1000, or `frameUnit = "weeks"`, or `frameUnit = "days"` with two `orderBy` keys or one descending key
- **THEN** the write is rejected with the existing step-config validation error response naming the problem, and nothing is persisted

#### Scenario: Draft window configs stay saveable
- **WHEN** a window config with an empty `function`, a `lag`/`lead`/`running_sum`/`rolling_*` with no `field`, or a `rolling_*` with no `frameSize` or an empty `orderBy`, is written
- **THEN** the write succeeds, and analyze and execution still report the incomplete config

#### Scenario: Missing field is reported before a bad offset at run time
- **WHEN** a stored `lag` or `lead` step has no `field` and a non-positive `offset`, and it executes
- **THEN** execution fails with the "requires 'field'" step configuration error, not the offset error

#### Scenario: Unsupported function is still reported first at run time
- **WHEN** a stored window step has an unsupported `function` and no `field`, and it executes
- **THEN** execution fails with the unsupported-function error

#### Scenario: Rejected save keeps the choice and marks the function control invalid
- **WHEN** a window step's config save is rejected with a 422
- **THEN** the editor shows the server's message as an inline error, keeps the selected function, and the function control has `aria-invalid="true"` and `aria-describedby` referencing the error's id

## ADDED Requirements

### Requirement: Rolling window functions aggregate a trailing frame
The `rolling_avg`, `rolling_sum`, `rolling_min`, `rolling_max` and `rolling_count` functions SHALL compute, for each
row, an aggregate of `field` over a trailing frame within the row's partition, ordered by `orderBy`. Frames are
trailing only: the current row and rows before it, never rows after it (except same-date peers in `days` mode).

With `frameUnit = "rows"` (or absent), the frame of the row at position `p` (0-based) in its partition's
`orderBy` order SHALL be positions `max(0, p - frameSize + 1)` through `p`, with the existing original-input-index
tie-break defining the position of rows with equal `orderBy` keys.

With `frameUnit = "days"`, `orderBy` SHALL be exactly one ascending key. Each row's key SHALL be read as a UTC
calendar date (timestamps reduced to their UTC date, using the same date parsing the `datebucket` op accepts). The
frame of a row dated `d` SHALL be every row of its partition dated within `[d - (frameSize - 1) days, d]`, so a
7-day frame covers 7 calendar days including the current one. Missing dates SHALL NOT be filled: a gap just means
fewer rows in the frame. Rows sharing a date are peers: each is in the others' frames and they SHALL all get the
same value. A row whose key is null or does not parse as a date SHALL get `null` and SHALL NOT be in any other row's
frame.

Leading partial frames SHALL emit a value computed over the rows available (the first row of a partition gets a
value over a frame of one row); they SHALL NOT emit `null` merely because the frame is not full.

Only values of `field` that are non-null and coerce to a number SHALL contribute; any other value is skipped, not
counted as `0`. `rolling_count` SHALL be the number of contributing values (an integer, `0` when none).
`rolling_avg`, `rolling_sum`, `rolling_min` and `rolling_max` SHALL be the mean, sum, minimum and maximum of the
contributing values as floating-point numbers, and `null` when the frame has no contributing value.

#### Scenario: 7-row moving average matches a hand-computed fixture, including the leading partial frames
- **WHEN** a `window` step runs `rolling_avg` with `frameSize = 7`, `frameUnit = "rows"`, `field = "v"`, ordered
  ascending by `day` over one partition with `v` = 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 in `day` order
- **THEN** the outputs in `day` order are 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7 (the first six rows average the rows
  available so far)

#### Scenario: Partitions are computed independently
- **WHEN** a rolling function runs with `partitionBy = ["team"]` over rows of two teams interleaved in the input
- **THEN** each row's frame contains only rows of its own team, and the output row order is the input row order

#### Scenario: A day frame does not fill gaps and shares a value across same-date peers
- **WHEN** `rolling_sum` runs with `frameSize = 3`, `frameUnit = "days"`, ordered ascending by `date`, over rows
  dated 2026-01-01 (v=1), 2026-01-02 (v=2), 2026-01-02 (v=3), 2026-01-05 (v=4), 2026-01-06 (v=5)
- **THEN** the outputs are 1, 6, 6, 4, 9: both 2026-01-02 rows share 1+2+3, the 2026-01-05 frame
  (2026-01-03..05) holds only itself, and the 2026-01-06 frame (2026-01-04..06) holds 4 and 5

#### Scenario: Unparseable dates and non-numeric values are skipped
- **WHEN** a `days` rolling step meets a row whose `orderBy` key is null or not a date, and a row whose `field` is
  null or non-numeric
- **THEN** the first row's output is `null` and it is in no other frame; the second row is in frames but contributes
  nothing, so a frame holding only such rows yields `null` for `rolling_avg`/`rolling_sum`/`rolling_min`/
  `rolling_max` and `0` for `rolling_count`

#### Scenario: Rolling function without frameSize or orderBy fails at run time
- **WHEN** a stored `rolling_avg` step with a `field` but no `frameSize`, or with an empty `orderBy`, executes
- **THEN** execution fails with a descriptive step configuration error naming the missing key

### Requirement: The window step editor configures rolling frames
The `window` step editor SHALL offer the five rolling functions. When one is selected it SHALL show the `field`
selector, a frame size number input, and a frame unit control (`rows`/`days`). Selecting a rolling function (changing
the function) on a config with no `frameSize` SHALL fill `frameSize = 7` and `frameUnit = "rows"`. A stored rolling
config with no `frameSize` SHALL display an empty frame size (never a value that is not stored), so the editor never
contradicts the run-time missing-`frameSize` error. The `field` the user picks SHALL be persisted for rolling
functions. The config the editor saves SHALL be
exactly the shape the server accepts (`frameSize` a number, `frameUnit` one of `rows`/`days`).

#### Scenario: Editor builds a rolling config the server accepts and runs
- **WHEN** a user picks `rolling_avg`, a field, frame size 7 and unit `days` in the editor
- **THEN** the step-update request body carries exactly the keys `partitionBy`, `orderBy`, `function`, `field`,
  `outputColumn`, `frameSize`, `frameUnit` with `function = "rolling_avg"`, `frameSize = 7`, `frameUnit = "days"`, and
  the server accepts, analyzes and runs that exact body

#### Scenario: A stored rolling config without frameSize shows an empty frame size
- **WHEN** the editor opens a stored `rolling_avg` step with no `frameSize`
- **THEN** the frame size input is empty, and nothing is persisted until the user changes a control
