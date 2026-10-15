## MODIFIED Requirements

### Requirement: Chart panel renders a live ECharts instance
The system SHALL mount an ECharts chart inside any `output` panel whose bound Output (`config.outputId`) is of kind `chart`. No panel kind is itself a chart or carries its own data binding; the chart's rows, `fieldMapping` and `aggregation` come from the bound Output (its config and materialized rows), and its chart type is resolved as below. The chart MUST fill the panel card body area not taken by its annotation or truncation footnote. The rendered chart type SHALL be the panel's stored `appearance.chart.chartType` when set, else the Output's `config.chartType` when it is a recognised chart type, else `line`. For `line`, `bar`, `scatter` and `pie`, when the Output's `fieldMapping.xAxis` is unset the first column SHALL be used as the x axis, and when `fieldMapping.yAxis` is unset every numeric column other than the x column SHALL be rendered as a series (a pie takes the first numeric column). `heatmap` and `histogram` do not use this fallback: they render only from their own required mappings (`heatmap`: x, series and y; `histogram`: x). When the Output's config carries an `aggregation` spec (`{ groupBy, agg, yField }`), the Output's own `config.chartType` is not a non-aggregating type, and the resolved chart type is `bar`, `line`, or `pie`, the chart SHALL instead group rows by `groupBy` and render one aggregate mark per group (see `panel-viz-aggregation`), taking precedence over the raw per-row rendering for that render. For `pie`, the aggregate renders as one `{name, value}` slice per group instead of the bar/line categories/values series shape. A non-aggregating resolved chart type (`scatter`, `heatmap`, `histogram`) never applies an `aggregation` spec even if one is present in the Output's config: backend Output-config validation rejects a non-aggregating Output `chartType` with an `aggregation` on write, but a legacy stored combination still renders raw rows, whatever panel-level `appearance.chart.chartType` override it carries, and so does a panel-level override to a non-aggregating type on an aggregating Output.

#### Scenario: Chart panel mounts an ECharts instance
- **WHEN** an `output` panel bound to a `chart` Output is displayed in the grid
- **THEN** an ECharts instance is rendered inside the panel card body

#### Scenario: Chart panel renders the stored chart type
- **WHEN** an `output` panel bound to a `chart` Output has `appearance.chart.chartType` set to a supported type
- **THEN** the ECharts instance renders that chart type (e.g. bar renders a bar chart), regardless of the Output's `config.chartType`

#### Scenario: An unrecognised Output chart type falls back to line
- **WHEN** the panel has no stored `appearance.chart.chartType`
- **THEN** the chart renders the Output's `config.chartType` if it is a recognised chart type, and a line chart otherwise (an unrecognised Output `config.chartType` renders a line chart without error)

#### Scenario: A chart Output with no rows shows a no-data state
- **WHEN** the bound `chart` Output's rows have loaded and there are none
- **THEN** the panel body shows "Not run yet" (with a Run pipeline action where available) when the Output has never been materialized, or "No data available" when it ran and returned zero rows, instead of a chart; an ECharts instance with an empty frame for the resolved chart type (empty category x axis and value y axis; no axes for a pie) is rendered only when loaded rows are narrowed to zero at render time (the client-side cross-filter fallback)

#### Scenario: Chart panel shows a loading state while the Output loads
- **WHEN** the bound Output's metadata or its first page of rows is still loading
- **THEN** the panel body shows the loading skeleton (`aria-label="Loading data"`) instead of a chart

#### Scenario: A chart Output with no yAxis mapping auto-detects numeric series
- **WHEN** the resolved chart type is `line`, `bar`, `scatter` or `pie` (not `heatmap`/`histogram`) and the bound `chart` Output's `fieldMapping` has no `yAxis`
- **THEN** the chart renders every numeric column other than the x column as a series, using the first column as the x axis when `xAxis` is also unset

#### Scenario: Chart fills the panel card body
- **WHEN** a chart panel is rendered
- **THEN** the ECharts canvas fills the full width and the card body height not taken by the annotation or truncation footnote

#### Scenario: No console errors on mount
- **WHEN** a chart panel mounts
- **THEN** no JavaScript errors or warnings are emitted to the console

#### Scenario: No console errors on unmount
- **WHEN** a chart panel is removed from the grid (panel deleted or dashboard changed)
- **THEN** the ECharts instance is disposed cleanly with no console errors

#### Scenario: Aggregation spec takes precedence over per-row field mapping for bar/line/pie
- **WHEN** a bar-chart Output has both `fieldMapping.xAxis`/`yAxis` set AND a valid `aggregation` spec
- **THEN** the chart renders the grouped/aggregated series, not the raw per-row series

#### Scenario: Aggregation spec produces pie slices, not bar/line series data
- **WHEN** a pie chart (resolved chart type `pie`) is bound to an Output with a valid `aggregation` spec
- **THEN** the chart's rendered series is a pie series with one `{name, value}` datum per group,
  reshaped from the same categories/values aggregate bar/line consume

#### Scenario: A non-aggregating chart type ignores an aggregation spec
- **WHEN** a bound Output's config carries an `aggregation` spec and either the chart's resolved type or the Output's own `config.chartType` is `scatter`, `heatmap` or `histogram` (a legacy stored combination, or a panel-level `appearance.chart.chartType` override)
- **THEN** the chart falls back to its non-aggregated raw-row rendering path using `fieldMapping`
