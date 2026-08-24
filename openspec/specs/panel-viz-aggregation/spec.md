# panel-viz-aggregation Specification

## Purpose
Defines viz-level aggregation for metric and chart panels — count/sum/avg/min/max over all bound rows for metrics, and groupBy aggregation into one mark per group for bar/line charts — so common aggregated views no longer require a dedicated pipeline `aggregate` step, while keeping pipelines as the transform/typing layer.
## Requirements
### Requirement: Metric panel supports a viz-level aggregation spec
A `MetricPanelConfig` SHALL have an optional `aggregation` property of shape `{ value: string, agg: "count" | "sum" | "avg" | "min" | "max" }`. When present, the metric panel's `value` slot SHALL render the result of applying `agg` to the `value` field across ALL rows returned for the panel's bound DataType, instead of reading `rows[0]`. `label`, `unit`, and `trend` slots are unaffected and continue to read `fieldMapping` off the first row. When `aggregation` is absent, the metric panel SHALL render exactly as before (`rows[0]` via `fieldMapping.value`). The Metric config UI SHALL present the choice between a plain field mapping and a reduced aggregation as a single Value control (one field selector + one Reduce selector) so `fieldMapping.value` and `aggregation` are never both set by user action: selecting "None (first row)" in the Reduce selector clears `aggregation` and writes `fieldMapping.value`; selecting any other reduce function clears `fieldMapping.value` and writes `aggregation`.

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

#### Scenario: Selecting a reduce function moves the field from mapping to aggregation
- **WHEN** the user has `fieldMapping.value = "price"` and no aggregation, and selects "Average" in
  the Value control's Reduce selector, then saves
- **THEN** the PATCH persists `aggregation = { value: "price", agg: "avg" }` and clears
  `fieldMapping.value`

#### Scenario: Selecting "None (first row)" moves the field back to field mapping
- **WHEN** the user has `aggregation = { value: "price", agg: "avg" }` and selects "None (first row)"
  in the Reduce selector, then saves
- **THEN** the PATCH persists `fieldMapping.value = "price"` and clears `aggregation`

### Requirement: Chart panel supports a viz-level groupBy aggregation spec
A `ChartPanelConfig` SHALL have an optional `aggregation` property of shape `{ groupBy: string, agg: "count" | "sum" | "avg" | "min" | "max", yField: string }`. When present and the chart's rendered type is `bar`, `line`, or `pie`, the chart SHALL group all bound rows by the `groupBy` field and plot one aggregate mark per group (categories = distinct `groupBy` values, values = `agg` applied to `yField` within each group), instead of plotting one mark per raw row. For `pie`, each group renders as one slice named by its `groupBy` value with the aggregate as its value. When `aggregation` is absent, the chart SHALL render exactly as before (one mark per row via `fieldMapping`). A chart panel's `chartType` of `scatter` combined with a present `aggregation` SHALL be rejected (400) at create/update time rather than accepted and ignored — see the "Scatter charts reject an aggregation spec" requirement below.

#### Scenario: Chart groups and aggregates rows into a bar chart
- **WHEN** a chart panel has `appearance.chart.chartType = "bar"` and
  `aggregation = { groupBy: "year", agg: "avg", yField: "rating" }` bound to a 1000-row DataType
- **THEN** the chart renders one bar per distinct `year` value, each showing the average `rating`
  for that year

#### Scenario: Chart aggregation is null-tolerant
- **WHEN** a chart panel's aggregation spec references a `yField` with null values in some rows
- **THEN** those rows are excluded from that group's aggregate computation

#### Scenario: Pie chart groups and aggregates rows into slices
- **WHEN** a chart panel has `appearance.chart.chartType = "pie"` and
  `aggregation = { groupBy: "status", agg: "count", yField: "id" }` bound to a multi-row DataType
- **THEN** the pie renders one slice per distinct `status` value, each sized by the count of rows in
  that group, instead of one slice per raw row

#### Scenario: Chart with no aggregation spec renders one mark per row as before
- **WHEN** a chart panel's config has no `aggregation` property
- **THEN** the chart renders one mark per raw row, matching pre-existing behavior

### Requirement: Aggregation semantics match the pipeline aggregate step
The frontend aggregation implementation SHALL match `AggregateStep`'s semantics: `count` counts rows where the target field is non-null; `sum`/`avg`/`min`/`max` operate over values coercible to a finite number (native numbers, or strings parseable as a finite number), skipping non-coercible values; `avg`/`min`/`max` SHALL evaluate to a null/absent result when zero rows have a coercible value for the target field (matching `AggregateStep`'s empty-`nums` to `null` behavior).

#### Scenario: Avg of an all-null field yields no value rather than NaN
- **WHEN** every row's target field is null or non-numeric for an `avg` aggregation
- **THEN** the aggregate result is treated as absent/no-data rather than `NaN` or a thrown error

### Requirement: Proposal and apply-proposal accept panel-level aggregation
`propose_dashboard`/`apply_proposal` MCP tool schemas, `schemas/dashboards/dashboard-proposal.schema.json`, and `schemas/panels/panel.schema.json` SHALL accept an optional `aggregation` object on metric/chart panel specs with the shapes defined above. A proposal/panel omitting `aggregation` SHALL apply unchanged from today (backwards compatible).

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

### Requirement: Metric aggregate value is formatted for display
The metric panel's rendered `value` slot SHALL cap displayed decimal precision at 2 fraction
digits (no thousands grouping) for any numeric value, so that a non-integer aggregate result
(e.g. an `avg` producing a long or repeating decimal) does not overflow the value slot. Integer
values and non-numeric string values (including non-finite results such as `"Infinity"`) SHALL
render unchanged. The `unit` slot SHALL continue to render as a separate suffix, unaffected by
value formatting.

#### Scenario: Long decimal avg is rounded for display
- **WHEN** a metric panel's `aggregation = { value: "rating", agg: "avg" }` computes to
  `3.3333333333333335`
- **THEN** the rendered value slot displays `"3.33"`

#### Scenario: Integer aggregate renders unchanged
- **WHEN** a metric panel's `aggregation = { value: "title", agg: "count" }` computes to `1500`
- **THEN** the rendered value slot displays `"1500"` (no added decimal digits, no thousands
  separator)

#### Scenario: Non-numeric metric value renders unchanged
- **WHEN** a metric panel's resolved value is a non-numeric string (e.g. `"Active"`)
- **THEN** the rendered value slot displays the string unchanged

#### Scenario: Non-finite aggregate value renders unchanged
- **WHEN** a metric panel's resolved value is the literal string `"Infinity"`
- **THEN** the rendered value slot displays `"Infinity"` unchanged (no rounding applied)

### Requirement: Scatter charts reject an aggregation spec
A chart panel's `create`/`update` (single, batch, replace-contents, apply-proposal, and dashboard-snapshot import paths) SHALL be rejected with a 400 error when the effective `appearance.chart.chartType` is `"scatter"` and the effective `config.aggregation` is present (set, non-null) — scatter plots a raw `{x, y}` coordinate pair per row and has no coordinate-level meaning for a categorical `groupBy` aggregate. "Effective" accounts for a partial PATCH: a chart-type-only update against a panel with an already-stored `aggregation`, or an aggregation-only update against a panel already typed `scatter`, are both rejected identically to setting both in the same request. A pre-existing stored panel that already combines `scatter` with an `aggregation` (from before this validation existed) SHALL continue to render using its current raw-row fallback — this validation blocks future writes only, it does not alter stored rows or reject reads. This requirement covers only the scatter+aggregation combination; it does not require dashboard-snapshot import to validate any other cross-field rule (e.g. the `chartType` enum) that import does not already enforce today — see the `echarts-chart-panel`/`panel-viz-aggregation` scope note and the tracked spinoff for bringing import to general parity with the rest of the write surface.

#### Scenario: Creating a scatter chart with an aggregation spec is rejected
- **WHEN** a chart panel is created with `appearance.chart.chartType = "scatter"` and
  `config.aggregation = { groupBy: "region", agg: "sum", yField: "sales" }`
- **THEN** the response is 400 and no panel is created

#### Scenario: Switching an aggregated chart to scatter is rejected
- **WHEN** a chart panel already has `chartType: "bar"` and a stored `aggregation`, and a PATCH sets only
  `appearance.chart.chartType` to `"scatter"` (the `aggregation` field is not part of this request)
- **THEN** the response is 400 and the panel's stored chart type and appearance are unchanged

#### Scenario: Adding an aggregation spec to an existing scatter chart is rejected
- **WHEN** a chart panel already has `chartType: "scatter"` and no `aggregation`, and a PATCH sets
  `config.aggregation = { groupBy: "region", agg: "sum", yField: "sales" }` (the `chartType` field is not
  part of this request)
- **THEN** the response is 400 and the panel's stored config is unchanged

#### Scenario: A batch update rejects one scatter+aggregation conflict without partially writing
- **WHEN** `updateBatch` includes one item that would result in a chart panel combining
  `chartType: "scatter"` with a present `aggregation`, alongside other valid items
- **THEN** the response is 400 naming the conflict and none of the batch's items are written

#### Scenario: A dashboard proposal with a scatter+aggregation chart panel is rejected before any write
- **WHEN** `apply_proposal`/`POST /api/dashboards/apply-proposal` is called with a chart panel spec
  combining `chartType: "scatter"` and a present `aggregation`
- **THEN** the response is 400 and no dashboard or panel is created — the request is rejected during
  pre-write validation, not via a swallowed follow-up appearance-patch failure that would otherwise let
  the panel exist with a silently different chart type

#### Scenario: A replace-contents request with a scatter+aggregation chart panel is rejected before any write
- **WHEN** `PUT /api/dashboards/:id/contents` is called with a panel combining `chartType: "scatter"` and a
  present `aggregation`, alongside other valid panels
- **THEN** the response is 400 and the dashboard's contents are left unchanged (no partial replace)

#### Scenario: A dashboard-snapshot import with a scatter+aggregation chart panel is rejected before any write
- **WHEN** `POST /api/dashboards/import` is called with a snapshot payload whose chart panel entry
  combines `appearance.chart.chartType: "scatter"` and a populated `config.aggregation`
- **THEN** the response is 400 and no dashboard or panel rows are created — the conflict is caught by
  `DashboardServiceValidation.validatePanelEntries`'s existing zero-write pre-pass, not by
  `DashboardSnapshotRepository.importSnapshot` persisting the panel unchecked

#### Scenario: A proposal panel cannot bypass the rejection via the generic config passthrough
- **WHEN** a proposal/replace-contents chart panel supplies `chartType: "scatter"` as its flat field and
  supplies `aggregation` via the generic `config` passthrough object (`config: { aggregation: {...} }`)
  instead of the panel spec's flat `aggregation` field
- **THEN** the response is still 400 and no dashboard or panel is created — the check evaluates the
  actually-resolved merged config (the same JSON the panel would be created with), not only the pre-merge
  flat `aggregation` field

#### Scenario: A pre-existing scatter+aggregation panel keeps rendering raw points
- **WHEN** a chart panel created before this validation existed already stores `chartType: "scatter"` and
  a non-null `aggregation`
- **THEN** reading/rendering that panel is unaffected — it continues to render raw per-row scatter points

