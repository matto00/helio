## MODIFIED Requirements

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

## ADDED Requirements

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
