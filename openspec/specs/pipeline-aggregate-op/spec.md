# pipeline-aggregate-op Specification

## Purpose
The `aggregate` pipeline step groups rows and computes per-group aggregations (sum, avg, min, max, count, median, percentile, count_distinct), with matching analyze-time type inference and an editor in the pipeline StepCard.

## Requirements

### Requirement: Aggregate step configures group-by fields and aggregation functions
The system SHALL provide an AggregateConfig component that allows the user to select zero or more
group-by fields from the step's inputSchema (via the analyze endpoint) and add one or more
aggregation rows each specifying an output alias, a function (sum/avg/min/max/count/median/percentile/count_distinct), a source
field, and — for percentile only — a numeric `p` (0–100). The component SHALL call onChange with the serialized config JSON on every change.

Config shape: `{"groupBy":[{"name":"<field>","type":"<type>"},...], "aggregations":[{"alias":"<out>","fn":"<fn>","field":"<src>","p":<0-100, percentile only>},...]}`.

#### Scenario: Renders group-by section with available fields
- **WHEN** AggregateConfig is rendered with a non-empty analyzeSchema
- **THEN** the group-by section shows each schema field name as a selectable option

#### Scenario: Renders aggregation rows with alias, fn, and field inputs
- **WHEN** AggregateConfig is rendered with an aggregations list containing one row
- **THEN** the alias input, fn dropdown, and field dropdown for that row are visible

#### Scenario: Adding a group-by field emits updated config
- **WHEN** the user selects a group-by field checkbox or button
- **THEN** onChange is called with config JSON where groupBy contains that field

#### Scenario: Adding an aggregation row emits updated config
- **WHEN** the user clicks "Add aggregation" and fills in alias, fn, and field
- **THEN** onChange is called with config JSON containing the new aggregation row

#### Scenario: Removing a group-by field emits updated config
- **WHEN** the user deselects a group-by field
- **THEN** onChange is called with config JSON where groupBy no longer contains that field

#### Scenario: Removing an aggregation row emits updated config
- **WHEN** the user removes an aggregation row
- **THEN** onChange is called with config JSON where that row is absent

#### Scenario: Inline warning shown for missing aggregation field
- **WHEN** an aggregation row references a field not present in analyzeSchema
- **THEN** an inline warning is shown next to that row

### Requirement: Aggregate step is selectable in the pipeline editor
The system SHALL include "aggregate" in the list of op types in PipelineDetailPage with initial
config `{"groupBy":[],"aggregations":[]}` and render AggregateConfig in the StepCard body when
the step's opType is "aggregate".

#### Scenario: Aggregate step is created with empty initial config
- **WHEN** the user selects "Group & aggregate" from the op dropdown
- **THEN** a new step is created and persisted with config `{"groupBy":[],"aggregations":[]}`

#### Scenario: AggregateConfig is rendered for an aggregate step
- **WHEN** an aggregate step's StepCard is expanded
- **THEN** the AggregateConfig component is rendered (not the generic placeholder)

### Requirement: Backend executes aggregate op using group-by and aggregation config
The InProcessPipelineEngine SHALL handle op `"aggregate"` using the config shape
`{groupBy: [{name, type}], aggregations: [{alias, fn, field, p?}]}` matching PipelineAnalyzeService.
It SHALL group rows by the groupBy field names, compute each aggregation (sum/avg/min/max/count/median/percentile/count_distinct)
over the named field per group, and return one output row per group containing the group-key
values plus each alias-named aggregation result. When the input row set is empty AND `groupBy` is
empty, the step SHALL produce exactly one output row: `count` and `count_distinct` equal to `0`, and
`sum`/`avg`/`min`/`max`/`median`/`percentile` each `null` (there being no rows to reduce). When the input row set is empty AND `groupBy` is
non-empty, the step SHALL produce zero output rows (there are no groups to report — this is a
deliberate anti-over-fix guard: an empty non-empty-groupBy input must NOT synthesize any zero-value
group rows).

#### Scenario: Groups rows by a single field and sums another
- **WHEN** aggregate op config has groupBy=[{name:"dept",type:"string"}] and aggregations=[{alias:"total_age",fn:"sum",field:"age"}]
- **THEN** output has one row per distinct dept value with total_age equal to the sum of age in that group

#### Scenario: Count fn produces non-null row count per group
- **WHEN** aggregate op config uses fn="count"
- **THEN** output contains the alias field with the count of non-null values of field per group

#### Scenario: Avg fn produces mean value per group
- **WHEN** aggregate op config uses fn="avg"
- **THEN** output alias field equals the arithmetic mean of the source field per group

#### Scenario: Min and max fns produce per-group extremes
- **WHEN** aggregate op config uses fn="min" or fn="max"
- **THEN** output alias equals the minimum or maximum value of the source field in that group

#### Scenario: Empty groupBy collapses all rows to one
- **WHEN** aggregate op config has groupBy=[] and one aggregation, and the input row set is non-empty
- **THEN** output is a single row with the aggregation result over all input rows

#### Scenario: Null values in aggregation field are skipped
- **WHEN** a row has null for the aggregation source field
- **THEN** that row is excluded from numeric aggregations (sum/avg/min/max/median/percentile) but count and count_distinct count non-nulls

#### Scenario: Empty groupBy over an empty input yields one zero-value row
- **WHEN** aggregate op config has groupBy=[] and the input row set has zero rows
- **THEN** output is a single row: `count` and `count_distinct` fns yield `0`, and
  `sum`/`avg`/`min`/`max`/`median`/`percentile` fns each yield `null`

#### Scenario: Non-empty groupBy over an empty input yields zero rows (anti-over-fix guard)
- **WHEN** aggregate op config has a non-empty groupBy and the input row set has zero rows
- **THEN** output has zero rows — no zero-value group row is synthesized for any group, since there
  are no groups to report

### Requirement: Aggregate step supports median, percentile and count_distinct
The aggregate step SHALL accept the functions `median`, `percentile` and `count_distinct` in
addition to `sum`/`avg`/`min`/`max`/`count` (function names case-insensitive). An aggregation MAY
carry a numeric `p`; `p` SHALL be required for `percentile`, SHALL be a finite number in the
inclusive range 0–100, and SHALL be rejected on any other function.

`median` and `percentile` SHALL operate on the numeric values of the field — values that the
existing `sum`/`avg` path treats as numeric (numbers and numeric strings) — ignoring nulls and
non-numeric values. `percentile` SHALL use linear interpolation between closest ranks (the
PostgreSQL `percentile_cont` definition: for sorted values v[0..n-1], position h = (n-1)·p/100,
result = v[floor(h)] + (h - floor(h))·(v[ceil(h)] - v[floor(h)])). `median` SHALL equal
`percentile` with p = 50 (so an even count yields the mean of the two middle values). Both SHALL
return a floating-point number, or null when there are no numeric values.

`count_distinct` SHALL return the number of distinct non-null values of the field, of any type, as
an integer.

#### Scenario: Median of an odd and an even count
- **WHEN** an aggregate step computes `median` over field values [3, 1, 2] and, in another group, [4, 1, 3, 2]
- **THEN** the results are 2.0 and 2.5 respectively

#### Scenario: Percentile with linear interpolation
- **WHEN** an aggregate step computes `percentile` with p = 90 over values [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
- **THEN** the result is 9.1

#### Scenario: Percentile endpoints
- **WHEN** `percentile` is computed with p = 0 and with p = 100
- **THEN** the results equal the minimum and the maximum numeric value respectively

#### Scenario: Numeric strings participate, nulls and non-numeric values are ignored
- **WHEN** `median` is computed over the values ["10", null, "abc", 30]
- **THEN** the result is 20.0

#### Scenario: count_distinct counts distinct non-null values
- **WHEN** `count_distinct` is computed over the values ["a", "b", "a", null, "c"]
- **THEN** the result is 3

#### Scenario: Grouped input
- **WHEN** an aggregate step groups by a field and computes median, percentile and count_distinct
- **THEN** each group row carries the function results computed over only that group's rows

#### Scenario: Group whose field is entirely null
- **WHEN** a group's rows all hold null for the aggregation field
- **THEN** `median` and `percentile` are null and `count_distinct` is 0

#### Scenario: Empty input with empty groupBy
- **WHEN** the input row set is empty and `groupBy` is empty
- **THEN** the single output row carries null for `median` and `percentile` and 0 for `count_distinct`

#### Scenario: Empty input with non-empty groupBy
- **WHEN** the input row set is empty and `groupBy` is non-empty
- **THEN** the step produces zero output rows

#### Scenario: Invalid aggregation configuration is rejected at write time
- **WHEN** a step create, step update, pipeline-proposal validate/apply or patch-set apply carries an aggregate config with an unsupported function, `percentile` without `p`, `p` outside 0–100 or non-finite, or `p` on a non-percentile function
- **THEN** the write is rejected with the existing step-config validation error response (the same path `validateRawConfig` already drives, e.g. 422 on REST) naming the problem, and nothing is persisted

#### Scenario: Invalid aggregation configuration is also caught by analyze, auto-run and apply
- **WHEN** such an invalid aggregate config is already stored (written before this change, or via a path that does not run write-time validation)
- **THEN** analyze reports exactly one validationError for the step naming the problem, `stepConfigProblem` (auto-run gate) reports it, and executing the step fails with a step configuration error instead of producing rows

### Requirement: Aggregate analyze types match apply for every supported function
Analyze type inference for an aggregate step SHALL type `median` and `percentile` results as
`float` and `count_distinct` results as `integer`, case-insensitively on the function name, and
SHALL be consistent with the runtime type `apply` produces for every function in
`AggregateStep.SupportedFunctions`.

#### Scenario: Inferred types for the new functions
- **WHEN** analyze runs on an aggregate step with `median`, `percentile` (p = 95) and `count_distinct` aggregations
- **THEN** the projected schema types those aliases `float`, `float` and `integer`

#### Scenario: Parity test covers every supported function
- **WHEN** a function is added to `AggregateStep.SupportedFunctions`
- **THEN** the apply/infer parity test exercises it without further edits, and fails if its inferred type disagrees with apply's runtime value type

### Requirement: Aggregate step editor offers the new functions
The `AggregateConfig` editor SHALL offer `median`, `percentile` and `count_distinct` in each
aggregation row's function picker, each with a hint. Selecting `percentile` SHALL show a numeric `p`
input (0–100) for that row; selecting any other function SHALL remove `p` from that row's config. Switching a row to `percentile`
SHALL seed `p: 50`.

#### Scenario: Choosing percentile reveals p
- **WHEN** the user selects `percentile` in an aggregation row's function picker and enters 90
- **THEN** onChange is called with that row carrying `fn: "percentile"` and `p: 90`

#### Scenario: Clearing or mistyping p does not emit an invalid p
- **WHEN** the user clears the `p` input or enters a value outside 0–100
- **THEN** an inline error is shown for that row and onChange is not called with the invalid value (the row keeps its last valid `p`)

#### Scenario: Switching away from percentile drops p
- **WHEN** a row with `fn: "percentile", p: 90` is switched to `median`
- **THEN** onChange is called with that row carrying `fn: "median"` and no `p` key
