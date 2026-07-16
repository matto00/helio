# echarts-chart-panel — Delta

## ADDED Requirements

### Requirement: Chart panel applies persisted per-type display options
The chart panel SHALL apply `config.chartOptions` entries for the active chart type
(`appearance.chart.chartType`, default `line`) to the rendered ECharts option via real ECharts
constructs:
- Line: `smooth` → `series.smooth`; `showPoints` → `series.showSymbol`; `areaFill` → `series.areaStyle`.
- Bar: `orientation: "horizontal"` → category/value axis roles swapped; `stacking: "stacked"` →
  `series.stack`; `stacking: "normalized"` → `series.stack` plus per-category percent-share values with a
  0–100 "%" value axis; `barGapPct` → `series.barCategoryGap`.
- Pie: `donutHolePct` → `series.radius: [<hole>%, <outer>%]`; `showPercentLabels` → `series.label` with a
  percentage formatter.
- Scatter: `sizeField` → a third data dimension driving `series.symbolSize`; `colorField` → one series
  per distinct field value with legend entries.

Options stored under other chart types MUST NOT affect the render. Entries absent within the active
type's options fall back to the current defaults. The aggregate render path (bar/line) MUST apply the
same active-type options. Mobile `compact` behavior (HEL-301) is unchanged and applied after options.

#### Scenario: Line options render
- **WHEN** a line chart panel has `chartOptions.line = { smooth: true, showPoints: false, areaFill: true }`
- **THEN** the built ECharts series has `smooth: true`, `showSymbol: false`, and an `areaStyle`

#### Scenario: Horizontal stacked bars render
- **WHEN** a bar chart panel has `chartOptions.bar = { orientation: "horizontal", stacking: "stacked" }`
- **THEN** the category axis is the y-axis and every series carries the same `stack` value

#### Scenario: Normalized stacking renders percent shares
- **WHEN** a bar chart panel has `chartOptions.bar.stacking = "normalized"` with multiple series
- **THEN** each category's rendered values sum to 100 and the value axis is labeled as percentages

#### Scenario: Donut with percentage labels renders
- **WHEN** a pie chart panel has `chartOptions.pie = { donutHolePct: 50, showPercentLabels: true }`
- **THEN** the pie series has a non-zero inner radius and labels including the `{d}` percentage

#### Scenario: Scatter size and color fields render
- **GIVEN** a bound scatter panel with `chartOptions.scatter = { sizeField: "population", colorField: "region" }`
- **WHEN** the chart renders
- **THEN** symbol sizes vary with the size field and one legend/series entry exists per distinct region

#### Scenario: Inactive type's options are ignored
- **WHEN** a line chart panel also has `chartOptions.pie` stored
- **THEN** the rendered line chart is unaffected by the pie entry
