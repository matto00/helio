# panel-viz-aggregation Specification

## Purpose
Defines viz-level aggregation for metric and chart panels — count/sum/avg/min/max over all bound rows for metrics, and groupBy aggregation into one mark per group for bar/line charts — so common aggregated views no longer require a dedicated pipeline `aggregate` step, while keeping pipelines as the transform/typing layer.
## Requirements
### Requirement: Metric panel supports a viz-level aggregation spec
A `MetricPanelConfig` SHALL have an optional `aggregation` property of shape `{ value: string, agg: "count" | "sum" | "avg" | "min" | "max" }`. When present, the metric panel's `value` slot SHALL render the result of applying `agg` to the `value` field across ALL rows returned for the panel's bound DataType, instead of reading `rows[0]`. `label`, `unit`, and `trend` slots are unaffected and continue to read `fieldMapping` off the first row. When `aggregation` is absent, the metric panel SHALL render exactly as before (`rows[0]` via `fieldMapping.value`).

#### Scenario: Metric renders avg aggregate over all rows
- **WHEN** a metric panel is bound to a DataType with `aggregation = { value: "rating", agg: "avg" }` and
  the DataType has 1000 rows
- **THEN** the metric's `value` slot displays the average of the `rating` field across all 1000 rows

#### Scenario: Metric renders count aggregate
- **WHEN** a metric panel has `aggregation = { value: "title", agg: "count" }`
- **THEN** the metric's `value` slot displays the count of rows where `title` is non-null

#### Scenario: Metric aggregation is null-tolerant
- **WHEN** a metric panel has `aggregation = { value: "rating", agg: "avg" }` and some rows have a
  null or non-numeric `rating` value
- **THEN** those rows are excluded from the average computation rather than producing an error or NaN

#### Scenario: Metric with no aggregation spec renders rows[0] as before
- **WHEN** a metric panel's config has no `aggregation` property
- **THEN** the metric's `value` slot renders `fieldMapping.value` read from the first bound row,
  matching pre-existing behavior

### Requirement: Chart panel supports a viz-level groupBy aggregation spec
A `ChartPanelConfig` SHALL have an optional `aggregation` property of shape `{ groupBy: string, agg: "count" | "sum" | "avg" | "min" | "max", yField: string }`. When present and the chart's rendered type is `bar` or `line`, the chart SHALL group all bound rows by the `groupBy` field and plot one aggregate mark per group (categories = distinct `groupBy` values, values = `agg` applied to `yField` within each group), instead of plotting one mark per raw row. When `aggregation` is absent, the chart SHALL render exactly as before (one mark per row via `fieldMapping`).

#### Scenario: Chart groups and aggregates rows into a bar chart
- **WHEN** a chart panel has `appearance.chart.chartType = "bar"` and
  `aggregation = { groupBy: "year", agg: "avg", yField: "rating" }` bound to a 1000-row DataType
- **THEN** the chart renders one bar per distinct `year` value, each showing the average `rating`
  for that year

#### Scenario: Chart aggregation is null-tolerant
- **WHEN** a chart panel's aggregation spec references a `yField` with null values in some rows
- **THEN** those rows are excluded from that group's aggregate computation

#### Scenario: Pie and scatter charts ignore the aggregation spec
- **WHEN** a chart panel has `appearance.chart.chartType` set to `"pie"` or `"scatter"` and an
  `aggregation` spec is present
- **THEN** the chart falls back to its existing non-aggregated rendering path using `fieldMapping`

#### Scenario: Chart with no aggregation spec renders one mark per row as before
- **WHEN** a chart panel's config has no `aggregation` property
- **THEN** the chart renders one mark per raw row, matching pre-existing behavior

### Requirement: Aggregation semantics match the pipeline aggregate step
The frontend aggregation implementation SHALL match `AggregateStep`'s semantics: `count` counts rows where the target field is non-null; `sum`/`avg`/`min`/`max` operate over values coercible to a finite number (native numbers, or strings parseable as a finite number), skipping non-coercible values; `avg`/`min`/`max` SHALL evaluate to a null/absent result when zero rows have a coercible value for the target field (matching `AggregateStep`'s empty-`nums` to `null` behavior).

#### Scenario: Avg of an all-null field yields no value rather than NaN
- **WHEN** every row's target field is null or non-numeric for an `avg` aggregation
- **THEN** the aggregate result is treated as absent/no-data rather than `NaN` or a thrown error

### Requirement: Proposal and apply-proposal accept panel-level aggregation
`propose_dashboard`/`apply_proposal` MCP tool schemas, `schemas/dashboard-proposal.schema.json`, and `schemas/panel.schema.json` SHALL accept an optional `aggregation` object on metric/chart panel specs with the shapes defined above. A proposal/panel omitting `aggregation` SHALL apply unchanged from today (backwards compatible).

#### Scenario: propose_dashboard accepts a metric panel with an aggregation spec
- **WHEN** `propose_dashboard` is called with a metric panel spec including
  `aggregation: { value: "rating", agg: "avg" }`
- **THEN** the tool returns the proposal JSON with the `aggregation` field preserved on that panel

#### Scenario: apply_proposal persists the aggregation spec on the created panel
- **WHEN** `apply_proposal` is called with a chart panel spec including
  `aggregation: { groupBy: "year", agg: "avg", yField: "rating" }`
- **THEN** the created panel's `config.aggregation` matches the supplied spec

#### Scenario: Proposal without an aggregation field applies as before
- **WHEN** `apply_proposal` is called with a panel spec that omits `aggregation`
- **THEN** the panel is created with no aggregation spec and renders as it did before this change

