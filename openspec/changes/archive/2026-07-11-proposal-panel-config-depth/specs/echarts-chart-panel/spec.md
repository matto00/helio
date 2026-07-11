## ADDED Requirements

### Requirement: Chart appearance is settable through the dashboard-proposal apply path
`POST /api/dashboards/apply-proposal` SHALL accept, per chart panel, optional `chartType`
(`bar`|`line`|`pie`|`scatter`), `xAxisLabel`, `yAxisLabel` (strings), and `seriesColors` (array of CSS
color strings). When any of these are present, the created panel's `appearance.chart` SHALL be set to
reflect them (defaulting unspecified sub-fields the same way the manual chart-appearance editor does)
so the panel renders with that chart type/axes/colors immediately, without a follow-up manual edit.
Applying a proposal that omits all chart-appearance fields for a chart panel SHALL leave that panel's
appearance at the default (today's behavior: a line chart with unset axis titles).

#### Scenario: Proposal-created bar chart applies with its chart type and axis titles
- **WHEN** a dashboard proposal's chart panel specifies `chartType: "bar"`, `xAxisLabel: "Rating"`,
  `yAxisLabel: "Count"`
- **THEN** the applied panel's `appearance.chart.chartType` is `"bar"` and `axisLabels.x.label`/
  `axisLabels.y.label` are `"Rating"`/`"Count"`

#### Scenario: Proposal-created chart with series colors applies those colors
- **WHEN** a dashboard proposal's chart panel specifies `seriesColors: ["#ff0000", "#00ff00"]`
- **THEN** the applied panel's `appearance.chart.seriesColors` includes those values

#### Scenario: Proposal chart panel with no appearance fields keeps default appearance
- **WHEN** a dashboard proposal's chart panel specifies no `chartType`/axis/`seriesColors` fields
- **THEN** the applied panel's `appearance.chart` is unset (renders as today's default line chart)

#### Scenario: An invalid chartType is rejected before anything is created
- **WHEN** `POST /api/dashboards/apply-proposal` is called with a chart panel's `chartType` set to a
  value outside `bar|line|pie|scatter`
- **THEN** the response is 400 and no dashboard or panel is created
