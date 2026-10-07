# chart-history-overlay Specification

## Purpose
A labelled "vs" overlay series on line/bar chart renders, drawn from a stored history summary series, in the History view and on dashboard chart panels whose Output has `config.compare`, with the rules that align it and omit it.

## Requirements

### Requirement: buildChartOption draws a labelled "vs" overlay series
`buildChartOption` SHALL accept an optional overlay `{label, points}` and, for `line` and `bar` chart types with a category x axis and exactly one primary series, append one extra series named by `label` (e.g. "vs 7d", "vs 5 Oct, 14:02") whose data is aligned to the primary x categories by exact category value (missing → null). The overlay SHALL be visually subordinate (dashed line / muted fill drawn from theme tokens or the chart palette data), SHALL appear in the legend, and SHALL be ignored for `pie`, `scatter`, multi-series primaries, bar charts with `stacking: "normalized"` (percent shares on a 0–100 axis), bar charts with `orientation: "horizontal"`, or when no primary x category matches any overlay point.

#### Scenario: Line overlay
- **WHEN** a single-series line chart has categories [Mon,Tue,Wed] and the overlay points are [[Mon,3],[Wed,5]]
- **THEN** the option has a second series named with the overlay label and data [3,null,5]

#### Scenario: Normalized and horizontal bars ignore overlay
- **WHEN** a single-series bar chart has `stacking: "normalized"`, or `orientation: "horizontal"`, and an overlay is supplied
- **THEN** the option has no overlay series

#### Scenario: Pie ignores overlay
- **WHEN** the chart type is pie and an overlay is supplied
- **THEN** the option has no overlay series

### Requirement: Dashboard chart panels overlay the config.compare baseline
A chart panel bound to an Output whose `config.compare` is set SHALL read that Output's history (authenticated or public variant, summary only — never payloads, sharing L5's history cache) and draw the overlay from `baseline.series`, labelled "vs <compare label>" using the same labels as the metric delta (`7d`/`1d`/`30d`, humanized custom such as `3d`/`12h`, or "previous" for `previous_run`; never "previous run"); when the label would be the generic "custom", the label SHALL be "vs <localized baseline capture date>" instead. When the Output is aggregated (its `config.chartType` is not `scatter` and `config.aggregation` names a groupBy, a supported agg and a yField), the overlay SHALL be drawn only when `baseline.series.mode` is `grouped` and its `x`/`y`/`agg` equal the aggregation's groupBy/yField/agg; otherwise it SHALL be drawn only when `baseline.series.mode` is `rows` and its `x`/`y` equal `fieldMapping.xAxis`/`fieldMapping.yAxis`. The overlay SHALL be omitted when: compare is null; baseline is null; the baseline series is null or downsampled; the baseline series does not match as above; the panel's loaded rows are not known to be the Output's complete row set (more pages remain on an authenticated surface, `total` exceeds the loaded rows on a public dashboard, or completeness is not supplied at all) — including for aggregated Outputs; the series is in `rows` mode and either side has a repeated x value; the primary chart has more than one series; or a viewer control filter or cross-filter is narrowing the panel's rows.

#### Scenario: Overlay on an authenticated dashboard
- **WHEN** a line chart panel's Output has compare `7d` and a baseline with a matching series
- **THEN** the chart shows a second legend entry "vs 7d"

#### Scenario: Public dashboard
- **WHEN** the same panel is viewed on a public dashboard
- **THEN** the overlay renders from the public history response and no payload endpoint is requested

#### Scenario: Viewer filter hides overlay
- **WHEN** a viewer control filter is applied to the panel
- **THEN** no overlay series is rendered

#### Scenario: Stale config hides overlay
- **WHEN** the baseline series' `y` field differs from the panel's current y field
- **THEN** no overlay series is rendered

#### Scenario: Aggregated chart Output overlays its grouped baseline
- **WHEN** a bar chart Output aggregates `sum(amount)` by `region`, its 150 rows are fully loaded, compare is `7d`, and the baseline series is `grouped` with x `region`, y `amount`, agg `sum`
- **THEN** the dashboard panel renders the grouped bars plus a "vs 7d" overlay series aligned by region

#### Scenario: Aggregated baseline with a different agg gets no overlay
- **WHEN** the same Output's baseline series is `grouped` with agg `avg`
- **THEN** no overlay series is rendered

#### Scenario: Aggregated chart Output gets no dashboard overlay
- **WHEN** an aggregated chart panel has more rows upstream than it loaded
- **THEN** no overlay series is rendered

#### Scenario: Truncated public chart gets no overlay
- **WHEN** a public dashboard chart panel's `total` is 350 while 200 rows are loaded, with compare `7d` and a matching baseline series
- **THEN** no overlay series is rendered

### Requirement: Compare picker on chart Outputs
The Output editor SHALL offer a Compare selector on every chart Output, in both create and edit mode, regardless of
chart type or config, with the options None, 1 day, 7 days and 30 days. Saving SHALL write `config.compare` as an
explicit JSON `null` for None (never an omitted key) or `1d`, `7d`, `30d`; an existing `previous_run` or `custom:`
value SHALL be shown as a selectable option and kept unchanged on save. The chart selector SHALL NOT introduce any
"previous" or "previous run" option label or copy beyond displaying an already-stored `previous_run` value. When a
chart Output is created as an aggregate tail, its Output config SHALL carry the selector's value. The selector SHALL
have fixed help text, programmatically associated with it, stating that the "vs" overlay does not show for Outputs
with more than 200 rows, a panel under a viewer filter or cross-filter, or pie, scatter, multi-series, 100%-stacked or
horizontal-bar charts; it SHALL NOT claim that aggregated Outputs never show the overlay. When a compare value other
than None is selected and the editor's current config already rules the overlay out — for a non-aggregated config,
`fieldMapping.series` set or `fieldMapping.xAxis` or `fieldMapping.yAxis` absent; for any config, bar `chartOptions`
with `orientation: "horizontal"` or `stacking: "normalized"` — the editor SHALL additionally show a specific note naming
that reason. An aggregated config SHALL NOT produce a note on account of its aggregation, its `fieldMapping.series`, or
absent `fieldMapping.xAxis`/`yAxis`. The note SHALL be derived from the same Output-level conditions the dashboard
overlay applies.

#### Scenario: Choosing 7 days on a chart Output persists
- **WHEN** an author opens a line chart Output, selects "7 days" and saves
- **THEN** the update payload's config contains `compare: "7d"`

#### Scenario: Choosing None clears a chart compare
- **WHEN** a chart Output with `compare: "30d"` is saved with "None"
- **THEN** the update payload's config contains `compare: null`

#### Scenario: Stored previous_run stays visible and clearable
- **WHEN** a chart Output with `compare: "previous_run"` (set via API) is opened
- **THEN** the selector shows that value, saving unchanged keeps `previous_run`, and choosing None saves `null`

#### Scenario: Aggregated chart Output gets a specific note
- **WHEN** a bar chart Output with groupBy, agg and yField set has "7 days" selected
- **THEN** the picker shows the general help text and no note about aggregation; only a horizontal or 100%-stacked bar
  option on that Output produces a note, naming that option

#### Scenario: Pie chart type is not hidden
- **WHEN** a chart Output's `chartType` is `pie`
- **THEN** the selector is still shown, with the general help text, and no Output-specific note on chart type alone

#### Scenario: Editor-set compare reaches the dashboard
- **WHEN** an author sets "7 days" in the editor on a raw-rows line chart Output with a matching 7-day-old baseline
  and opens a dashboard showing it
- **THEN** the chart panel shows a legend entry "vs 7d" without a page reload

### Requirement: Dashboard chart panels render config.aggregation
A dashboard chart panel bound to an aggregated chart Output (its `config.chartType` is not `scatter` and
`config.aggregation` names a groupBy, a supported agg and a yField) SHALL plot one value per group, computed from the
panel's loaded row records with the same grouping function and the same aggregation condition the Output editor
preview uses, on every surface that renders the panel (dashboard card, mobile stack, fullscreen, detail modal, public
viewer). Grouping SHALL operate on the loaded row records, after any client-side cross-filter narrowing, so missing
values group as the preview and the stored summary series group them. A click on an aggregated chart's category SHALL
produce a selection whose dimension is the aggregation's groupBy and whose value is the clicked category, and the
Inspect view it opens SHALL list exactly the loaded rows whose groupBy value equals that category. The aggregated
primary series SHALL be named `<agg>(<yField>)`.

#### Scenario: Aggregated bar chart on a dashboard matches the editor preview
- **WHEN** a bar chart Output aggregates `sum(amount)` by `region` over rows east=10, east=5, west=7
- **THEN** the dashboard panel shows two bars, east 15 and west 7, as the editor preview does

#### Scenario: Fullscreen and detail modal agree
- **WHEN** the same panel is opened fullscreen or in the detail modal
- **THEN** it shows the same two grouped bars

#### Scenario: Click selects the groupBy dimension
- **WHEN** a viewer clicks the `west` bar
- **THEN** the selection's dimension is `region` and its value is `west`

#### Scenario: Inspect lists the clicked group's rows
- **WHEN** a viewer clicks the `west` bar of that chart
- **THEN** the Inspect view lists exactly the `region = west` rows

### Requirement: Compact chart panels keep the overlay legend
When a chart panel renders in compact mode (phone stack or measured-small) and an overlay series is actually drawn, the
compact-mode legend hide SHALL NOT apply: the legend SHALL follow the panel's own legend appearance (an explicitly
hidden legend stays hidden; a stored position is honoured) in a compact form, so the overlay's label is readable
without hovering. Compact charts with no drawn overlay SHALL keep their legend hidden as before.

#### Scenario: Compact panel with overlay shows legend
- **WHEN** a default-size compact line chart panel draws a "vs 7d" overlay
- **THEN** the legend is shown and includes "vs 7d"

#### Scenario: Explicitly hidden legend stays hidden
- **WHEN** a compact chart panel draws an overlay and its appearance stores `chart.legend.show: false`
- **THEN** the legend is hidden

#### Scenario: Compact panel without overlay hides legend
- **WHEN** a compact chart panel draws no overlay
- **THEN** the legend is hidden

### Requirement: Dashboard chart type defaults to the Output's chartType
A chart panel whose stored appearance sets no `chart.chartType` SHALL render with the bound Output's `config.chartType`
(the type the editor preview and the History view use), without writing to the stored appearance. A stored panel
`chart.chartType` SHALL still take precedence. The same resolved type SHALL drive click mapping and the Inspect view.
Saving the panel detail modal SHALL NOT write `appearance.chart`.

#### Scenario: Bar Output on a panel with no stored chart type
- **WHEN** a bar chart Output is placed on a dashboard and the panel's appearance has no `chart.chartType`
- **THEN** the panel renders bars, matching the History view

#### Scenario: Explicit panel chart type wins
- **WHEN** the panel's stored appearance has `chart.chartType: "line"` and the Output's chartType is `bar`
- **THEN** the panel renders a line

#### Scenario: Detail modal save does not freeze the type
- **WHEN** an author opens the detail modal on that no-stored-type bar panel and saves
- **THEN** the save payload carries no `appearance.chart` and the panel keeps rendering the Output's type
