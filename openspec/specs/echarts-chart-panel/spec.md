# echarts-chart-panel Specification

## Purpose
Defines the ECharts-based chart panel that renders inside any panel with `type: "chart"`. Covers mounting, resizing, empty states, chart type rendering, and clean disposal.
## Requirements
### Requirement: Chart panel renders a live ECharts instance
The system SHALL mount an ECharts chart inside any panel whose `type` is `"chart"`. The chart MUST fill the available panel card body area. When `fieldMapping.xAxis` and `fieldMapping.yAxis` are both set and data is available, the chart SHALL render a live series using the bound data; when fields are not mapped, the chart SHALL show an informative empty-state message ("Select fields to display chart data") rather than a blank canvas. If no field mapping is present, a placeholder chart SHALL be displayed defaulting to a line chart. When the panel's config carries a viz-level `aggregation` spec (`{ groupBy, agg, yField }`) and the rendered chart type is `bar` or `line`, the chart SHALL instead group rows by `groupBy` and render one aggregate mark per group (see `panel-viz-aggregation`), taking precedence over the raw `fieldMapping.xAxis`/`yAxis` per-row rendering for that render.

#### Scenario: Chart panel mounts an ECharts instance
- **WHEN** a panel with `type: "chart"` is displayed in the grid
- **THEN** an ECharts canvas element is rendered inside the panel card body

#### Scenario: Chart panel renders the stored chart type
- **WHEN** a panel with `type: "chart"` has `appearance.chartType` set to a supported type
- **THEN** the ECharts instance renders that chart type (e.g. bar renders a bar chart)

#### Scenario: Unbound chart panel shows an empty default chart
- **WHEN** a panel with `type: "chart"` has no data bound (`typeId` is absent)
- **THEN** an empty chart with placeholder axes is displayed using the selected chart type (or line if unset)

#### Scenario: Chart panel with unknown chartType falls back to line
- **WHEN** a panel with `type: "chart"` has an unrecognised `appearance.chartType` value
- **THEN** a line chart is rendered without error

#### Scenario: Bound chart panel with no field mapping shows empty state message
- **WHEN** a panel with `type: "chart"` is bound to a DataType but `fieldMapping` has no xAxis or yAxis
- **THEN** the panel body shows "Select fields to display chart data" instead of a blank canvas

#### Scenario: Chart fills the panel card body
- **WHEN** a chart panel is rendered
- **THEN** the ECharts canvas fills 100% of the available card body height and width

#### Scenario: No console errors on mount
- **WHEN** a chart panel mounts
- **THEN** no JavaScript errors or warnings are emitted to the console

#### Scenario: No console errors on unmount
- **WHEN** a chart panel is removed from the grid (panel deleted or dashboard changed)
- **THEN** the ECharts instance is disposed cleanly with no console errors

#### Scenario: Aggregation spec takes precedence over per-row field mapping for bar/line
- **WHEN** a bar-chart panel has both `fieldMapping.xAxis`/`yAxis` set AND a valid `aggregation` spec
- **THEN** the chart renders the grouped/aggregated series, not the raw per-row series

### Requirement: Chart panel resizes with the grid panel
The ECharts instance MUST reflow to match the panel card dimensions whenever the panel is resized
on the dashboard grid.

#### Scenario: Chart resizes when panel is resized
- **WHEN** the user drags a chart panel's resize handle to a new size
- **THEN** the ECharts canvas updates its dimensions to fill the new panel size without overflow or blank space

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

### Requirement: Chart panel supports an optional static annotation

Chart panel config SHALL accept an optional `annotation` string. When `annotation` is a non-blank
string, the chart panel SHALL render it as a subtitle/footnote beneath the chart title area (distinct
from the chart's axis titles). When `annotation` is absent, null, empty, or whitespace-only, no
annotation element SHALL be rendered (the chart appears exactly as today). The annotation text SHALL
scale with the panel and wrap or truncate gracefully (clamped with an ellipsis) rather than overflowing
or shrinking the chart canvas out of view.

#### Scenario: Chart panel with an annotation renders a subtitle
- **WHEN** a chart panel has `config.annotation: "Source: Bureau of Labor Statistics"`
- **THEN** the panel renders the chart with a subtitle/footnote showing that text

#### Scenario: Chart panel without an annotation renders none
- **WHEN** a chart panel has no `annotation` (absent, null, empty, or whitespace-only)
- **THEN** the panel renders only the chart with no annotation element

#### Scenario: A long annotation truncates rather than overflowing
- **WHEN** a chart panel's `annotation` is longer than the panel width
- **THEN** the annotation is clamped within the panel body and does not overflow or collapse the chart

### Requirement: Chart panel annotation round-trips through the panel API

The `PATCH /api/panels/:id` endpoint SHALL accept an optional `annotation` field (string or null) on
chart panels and persist it. Absent `annotation` SHALL leave the stored value unchanged; a `null`,
empty, or whitespace-only `annotation` SHALL clear it (stored as SQL `NULL`). A chart panel response's
`config` SHALL include `annotation` when it is set and SHALL omit `annotation` when it is unset,
following the in-repo spray-json `None`-omission convention (fields are absent, not `null`; see
`collection-panel-type`). Because the panel response carries a per-subtype nested `config`, panels of
other types carry no `annotation` field at all. The annotation SHALL be carried through panel
duplication and dashboard export/import.

#### Scenario: PATCH sets an annotation on a chart panel
- **WHEN** a PATCH request is sent with `annotation: "Preliminary data"` on a chart panel
- **THEN** the response `config` includes `annotation: "Preliminary data"`

#### Scenario: PATCH without an annotation leaves it unchanged
- **WHEN** a PATCH request omits the `annotation` field on a chart panel with an existing annotation
- **THEN** the panel's existing `annotation` is preserved in the response `config`

#### Scenario: PATCH with null annotation clears it
- **WHEN** a PATCH request is sent with `annotation: null` on a chart panel that had an annotation
- **THEN** the response `config` omits `annotation`

#### Scenario: A non-chart panel config carries no annotation field
- **WHEN** a panel whose type is not `chart` is retrieved
- **THEN** its `config` contains no `annotation` field

#### Scenario: Duplicating a chart panel copies its annotation
- **WHEN** a chart panel with `annotation: "Fig. 2"` is duplicated
- **THEN** the duplicate's `annotation` is `"Fig. 2"`

### Requirement: Chart panel config editor exposes the annotation field

The Chart panel's config/display editor SHALL offer a control for the `annotation` that lets the user choose
the annotation **source**: fixed text or a bound DataType field, using the shared field-or-literal control
(`BoundOrLiteralField`). In "Fixed text" mode the control is a text input persisting `config.annotation`; in
"Bind to field" mode it is a DataType field dropdown persisting `fieldMapping.annotation`. Selecting one mode
SHALL clear the other side (Fixed text clears `fieldMapping.annotation`; Bind to field clears
`config.annotation` to null). The "Bind to field" mode SHALL be available only when a DataType is bound. The
mode SHALL default to "Fixed text" when `config.annotation` is set, otherwise to "Bind to field" when
`fieldMapping.annotation` is set. Saving SHALL persist the choice via `PATCH /api/panels/:id`; clearing the
control SHALL clear the corresponding stored value.

#### Scenario: Editing a fixed-text annotation persists it

- **WHEN** a user keeps the Annotation control in "Fixed text" mode, types "Source: internal", and saves
- **THEN** `PATCH /api/panels/:id` is called with `config.annotation` set to that text and the panel
  re-renders showing the annotation

#### Scenario: Binding the annotation to a field persists the slot

- **WHEN** a user switches the Annotation control to "Bind to field", selects the "note" column, and saves
- **THEN** `PATCH /api/panels/:id` is called with `fieldMapping.annotation: "note"` and `config.annotation`
  cleared, and the panel re-renders showing the bound value

#### Scenario: Bind-to-field is unavailable without a bound DataType

- **WHEN** a chart panel has no DataType bound and the Annotation control is opened
- **THEN** the "Bind to field" mode is not offered (only fixed text is available)

#### Scenario: Clearing the annotation control clears the stored annotation

- **WHEN** a user empties the annotation control on a chart panel that had a fixed-text annotation and saves
- **THEN** `PATCH /api/panels/:id` clears the annotation and the panel re-renders with no annotation

### Requirement: Chart annotation may be sourced from a bound DataType field

A chart panel's annotation SHALL be sourceable from a bound DataType field as an alternative to static
text. The bound source SHALL be expressed as the reserved `fieldMapping.annotation` slot referencing a
column key of the chart's bound DataType. When `fieldMapping.annotation` is set, the chart SHALL render the
value of that column from the current row snapshot (the first / single row) as the annotation, and the
rendered annotation SHALL update when the underlying data changes. When `fieldMapping.annotation` is absent,
the static `config.annotation` behavior is unchanged. When both are present, the static `config.annotation`
literal SHALL win (mirroring the Metric literal-wins resolution). No new persisted column or chart domain
field is introduced — the bound slot lives in the existing `fieldMapping` object, which is already stored,
round-tripped, and included in the panel query.

#### Scenario: Chart with a bound annotation renders the field value

- **WHEN** a chart panel has `fieldMapping.annotation: "note"`, no static `config.annotation`, and its bound
  DataType's first row has `note = "Preliminary — revised weekly"`
- **THEN** the panel renders the annotation element showing "Preliminary — revised weekly"

#### Scenario: Bound annotation updates when the data changes

- **WHEN** a chart panel's bound annotation column value changes after a new pipeline run and the panel's
  data refreshes
- **THEN** the rendered annotation reflects the new column value without an edit to the panel config

#### Scenario: Static annotation still renders and wins over a bound slot

- **WHEN** a chart panel has both `config.annotation: "Fixed note"` and `fieldMapping.annotation: "note"`
- **THEN** the panel renders "Fixed note"

#### Scenario: A bound annotation column is fetched by the panel query

- **WHEN** a chart panel sets `fieldMapping.annotation` to a column not otherwise mapped to an axis
- **THEN** that column is included in the panel's selected fields so its value is available to render

#### Scenario: Bound annotation round-trips through the panel API

- **WHEN** a PATCH sets `fieldMapping` including `annotation: "note"` on a chart panel, and the panel is
  re-read and duplicated
- **THEN** the stored and duplicated `config.fieldMapping.annotation` is `"note"`

