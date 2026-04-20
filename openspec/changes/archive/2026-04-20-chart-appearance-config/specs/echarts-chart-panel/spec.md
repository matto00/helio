## ADDED Requirements

### Requirement: Chart panel applies appearance settings to ECharts options
The ECharts instance MUST consume the panel's `chart` appearance sub-object and translate it into ECharts options so the rendered chart reflects the configured series colors, legend, tooltip, and axis labels.

#### Scenario: Series colors are applied to the chart
- **WHEN** a chart panel has a non-empty `seriesColors` array in its `chart` appearance
- **THEN** the ECharts instance uses those colors as the top-level `color` option

#### Scenario: Legend visibility is controlled by appearance
- **WHEN** `chart.legend.show` is `false`
- **THEN** the ECharts legend is hidden

#### Scenario: Legend position is applied
- **WHEN** `chart.legend.position` is set to `"top"`, `"bottom"`, `"left"`, or `"right"`
- **THEN** the ECharts legend renders at the configured position

#### Scenario: Tooltip is controlled by appearance
- **WHEN** `chart.tooltip.enabled` is `false`
- **THEN** the ECharts tooltip trigger is set to `"none"` (tooltip is disabled)

#### Scenario: X axis label visibility is controlled by appearance
- **WHEN** `chart.axisLabels.showX` is `false`
- **THEN** the ECharts xAxis `name` is empty and `axisLabel.show` is `false`

#### Scenario: Y axis label visibility is controlled by appearance
- **WHEN** `chart.axisLabels.showY` is `false`
- **THEN** the ECharts yAxis `name` is empty and `axisLabel.show` is `false`

#### Scenario: Custom axis label text is applied
- **WHEN** `chart.axisLabels.labelX` or `chart.axisLabels.labelY` is a non-empty string and the corresponding axis is shown
- **THEN** the ECharts axis `name` is set to that string

### Requirement: Chart panel accepts appearance as a prop for live preview
The `ChartPanel` component MUST accept an optional `appearance` prop so the panel detail modal can pass draft appearance state and show a live preview without persisting.

#### Scenario: Modal passes draft appearance to ChartPanel for preview
- **WHEN** the user changes a chart appearance setting in the panel detail modal
- **THEN** the chart rendered inside the modal updates immediately to reflect the new setting without a save action

#### Scenario: Grid-rendered chart uses saved appearance from Redux store
- **WHEN** a chart panel is rendered in the dashboard grid
- **THEN** it uses the panel's saved `appearance` from the Redux store
