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
A chart panel bound to an Output whose `config.compare` is set SHALL read that Output's history (authenticated or public variant, summary only — never payloads, sharing L5's history cache) and draw the overlay from `baseline.series`, labelled "vs <compare label>" using the same labels as the metric delta (`7d`/`1d`/`30d`, humanized custom such as `3d`/`12h`, or "previous" for `previous_run`; never "previous run"); when the label would be the generic "custom", the label SHALL be "vs <localized baseline capture date>" instead. Dashboard chart panels plot raw rows (`fieldMapping.xAxis` by `fieldMapping.yAxis`) and ignore `config.aggregation`, so the overlay SHALL be drawn only when `baseline.series.mode` is `rows` and its `x`/`y` equal `fieldMapping.xAxis`/`fieldMapping.yAxis`; a chart Output with `config.aggregation` set SHALL get no dashboard overlay. The overlay SHALL be omitted when: compare is null; baseline is null; the baseline series is null or downsampled; the baseline series is not a `rows`-mode series matching the panel's `fieldMapping.xAxis`/`fieldMapping.yAxis`; the panel's loaded rows are not known to be the Output's complete row set (more pages remain on an authenticated surface, `total` exceeds the loaded rows on a public dashboard, or completeness is not supplied at all); the series is in `rows` mode and either side has a repeated x value; the primary chart has more than one series; or a viewer control filter or cross-filter is narrowing the panel's rows.

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

#### Scenario: Aggregated chart Output gets no dashboard overlay
- **WHEN** a chart Output has `config.aggregation` set and its baseline series is `grouped` with matching groupBy/yField/agg
- **THEN** the dashboard panel renders no overlay series

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
have fixed help text, programmatically associated with it, stating that the "vs" overlay does not show for aggregated
Outputs, Outputs with more than 200 rows, a panel under a viewer filter or cross-filter, or pie, scatter,
multi-series, 100%-stacked or horizontal-bar charts. When a compare value other than None is selected and the
editor's current config already rules the overlay out — `config.aggregation` set, `fieldMapping.series` set,
`fieldMapping.xAxis` or `fieldMapping.yAxis` absent, or bar `chartOptions` with `orientation: "horizontal"` or
`stacking: "normalized"` — the editor SHALL additionally show a specific note naming that reason. The note SHALL be
derived from the same Output-level conditions the dashboard overlay applies, never from the Output's `chartType`.

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
- **WHEN** a chart Output with `config.aggregation` set has "7 days" selected
- **THEN** the picker is shown with the general help text and a note that this Output's aggregation prevents the overlay

#### Scenario: Pie chart type is not hidden
- **WHEN** a chart Output's `chartType` is `pie`
- **THEN** the selector is still shown, with the general help text, and no Output-specific note on chart type alone

#### Scenario: Editor-set compare reaches the dashboard
- **WHEN** an author sets "7 days" in the editor on a raw-rows line chart Output with a matching 7-day-old baseline
  and opens a dashboard showing it
- **THEN** the chart panel shows a legend entry "vs 7d" without a page reload
