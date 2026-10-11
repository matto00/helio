## MODIFIED Requirements

### Requirement: Output config writes validate aggregation and chartType
Every Output config write listed above (except restoring journaled prior config) SHALL, when the written
`aggregation` differs from the stored one (always on create), accept `aggregation` only as `null` (chart/metric), as
`{ groupBy, agg, yField }` on a chart Output, or as `{ agg }` or `{ value, agg }` on a metric Output, where every named
field is a non-empty string, `agg` is one of `count`, `sum`, `avg`, `min`, `max`, and no other field is present. When
such a write sets a non-null metric `aggregation`, the resulting config SHALL name its field via `fieldMapping.value` or
`aggregation.value`, and when both are present they SHALL be equal; a metric with a null or absent aggregation needs no
field. A chart Output whose resulting `chartType` is `scatter`, `heatmap` or `histogram` SHALL NOT carry a non-null
`aggregation` (these chart types never aggregate) when the write changes either key from its stored value.
`chartType`, when written, SHALL be `null` or one of `bar`, `line`, `pie`, `scatter`, `heatmap`, `histogram`. When a
write changes `chartOptions.histogram.binCount` from its stored value, the new value SHALL be absent, `null` or a whole
number from 2 to 100. Any violation SHALL be a 400 with a message naming `aggregation`, `chartType` or `binCount` and
the problem; nothing SHALL be persisted.

#### Scenario: Well-formed chart aggregation is accepted and rendered
- **WHEN** a bar chart Output is created with `aggregation: { groupBy: "region", agg: "sum", yField: "amount" }`
- **THEN** the write succeeds and a dashboard panel bound to it plots one bar per region with the summed amount

#### Scenario: Malformed chart aggregation is rejected
- **WHEN** a chart Output is written with `aggregation` missing `yField`, with `agg: "median"`, or metric-shaped
  `{ value, agg }`
- **THEN** the response is 400 naming `aggregation`

#### Scenario: Aggregation on a scatter chart or a non-aggregating kind is rejected
- **WHEN** a chart Output with `chartType: "scatter"` is written with a non-null `aggregation`, or a table Output is
  written with any `aggregation`
- **THEN** the response is 400 naming `aggregation`

#### Scenario: Aggregation on a heatmap or histogram is rejected
- **WHEN** a chart Output with `chartType: "heatmap"` or `"histogram"` is written with a non-null `aggregation`, or a
  stored aggregated bar chart is patched to `chartType: "histogram"`
- **THEN** the response is 400 naming `aggregation`

#### Scenario: Histogram bin count is validated
- **WHEN** a chart Output is written with `chartOptions.histogram.binCount` of 1, 101, 2.5 or `"10"`
- **THEN** the response is 400 naming `binCount`
- **WHEN** it is written with `binCount` 2, 100 or `null`
- **THEN** the write succeeds

#### Scenario: Metric aggregation shapes
- **WHEN** a metric Output is written with `fieldMapping.value: "amount"` and `aggregation: { agg: "sum" }`, or with
  `aggregation: { value: "amount", agg: "sum" }` and no `fieldMapping.value`
- **THEN** the write succeeds
- **WHEN** a metric Output is written with `aggregation: { agg: "sum" }` and no field, or with
  `fieldMapping.value: "a"` and `aggregation: { value: "b", agg: "sum" }`
- **THEN** the response is 400 naming `aggregation`
- **WHEN** a metric Output is written with `{ fieldMapping: {}, aggregation: null }` or `{ fieldMapping: { label: "x" } }`
- **THEN** the write succeeds

#### Scenario: Rollback restores a value the new rules reject
- **WHEN** a patch set changes a stored scatter chart carrying an aggregation to `chartType: "bar"` and is rolled back
- **THEN** the rollback succeeds and the original scatter config with its aggregation is restored

#### Scenario: Unknown chartType is rejected
- **WHEN** a chart Output is written with `chartType: "area"`
- **THEN** the response is 400 naming `chartType`
