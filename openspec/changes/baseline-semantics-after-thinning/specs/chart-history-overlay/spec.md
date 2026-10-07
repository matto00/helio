## MODIFIED Requirements

### Requirement: Compare picker on chart Outputs
The Output editor SHALL offer a Compare selector on every chart Output, in both create and edit mode, regardless of
chart type or config, with the options None, Previous, 1 day, 7 days and 30 days (the same options as metric Outputs).
Saving SHALL write `config.compare` as an explicit JSON `null` for None (never an omitted key) or `previous_run`, `1d`,
`7d`, `30d`; an existing `custom:` value SHALL be shown as a selectable option and kept unchanged on save. When a
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

#### Scenario: Choosing Previous on a chart Output persists
- **WHEN** an author opens a line chart Output, selects "Previous" and saves
- **THEN** the update payload's config contains `compare: "previous_run"`, listed once in the selector

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
