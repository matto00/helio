## MODIFIED Requirements

### Requirement: Backend executes aggregate op using group-by and aggregation config
The InProcessPipelineEngine SHALL handle op `"aggregate"` using the config shape
`{groupBy: [{name, type}], aggregations: [{alias, fn, field}]}` matching PipelineAnalyzeService.
It SHALL group rows by the groupBy field names, compute each aggregation (sum/avg/min/max/count)
over the named field per group, and return one output row per group containing the group-key
values plus each alias-named aggregation result. When the input row set is empty AND `groupBy` is
empty, the step SHALL produce exactly one output row: `count` equal to `0`, and `sum`/`avg`/`min`/`max`
each `null` (there being no rows to reduce). When the input row set is empty AND `groupBy` is
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
- **THEN** that row is excluded from numeric aggregations (sum/avg/min/max) but count counts non-nulls

#### Scenario: Empty groupBy over an empty input yields one zero-value row
- **WHEN** aggregate op config has groupBy=[] and the input row set has zero rows
- **THEN** output is a single row: `count` fn yields `0`, and `sum`/`avg`/`min`/`max` fns each yield
  `null`

#### Scenario: Non-empty groupBy over an empty input yields zero rows (anti-over-fix guard)
- **WHEN** aggregate op config has a non-empty groupBy and the input row set has zero rows
- **THEN** output has zero rows — no zero-value group row is synthesized for any group, since there
  are no groups to report
