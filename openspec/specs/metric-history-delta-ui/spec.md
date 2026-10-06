# metric-history-delta-ui Specification

## Purpose
How a metric Output panel presents its stored run history: the server's all-rows headline, a delta against the
Output's configured comparison, a sparkline, the filtered-state rule, the compare picker, and the provenance
"compared with" detail, on both authenticated and public dashboards.

## Requirements

### Requirement: Metric headline uses the server all-rows value when it matches the current config
A metric panel SHALL display the latest history point's server-computed value (`current.value`) as its headline
when no viewer filter is active, the history response has a non-null `current.value`, and the newest history
point's `summary.metric.field` and `summary.metric.agg` equal the field and aggregation the current Output config
resolves to under the server's selection rule. Otherwise the panel SHALL display the value computed from the loaded
rows exactly as before this change.

#### Scenario: Server value replaces the loaded-rows value
- **WHEN** a metric panel's loaded first 200 rows sum to 900 and the history `current.value` is 1204 for the same field/agg
- **THEN** the headline shows 1204 (formatted per the Output's `format`)

#### Scenario: No history yet falls back
- **WHEN** the history response has `current: null`
- **THEN** the headline shows the loaded-rows value and no delta or sparkline is rendered

#### Scenario: Config edited since the last run falls back
- **WHEN** the newest point's `summary.metric.agg` is `sum` but the current config's aggregation is `avg`
- **THEN** the headline shows the loaded-rows value and no delta, available-from note or sparkline is rendered

#### Scenario: Points from an earlier config are excluded
- **WHEN** the head matches the current config but older points' `summary.metric.agg` is `sum` while the config is `avg`
- **THEN** the sparkline omits those older points, and the delta is hidden if the baseline is one of them

### Requirement: Metric delta shows direction, magnitude and comparison window
When the server headline is shown, `compare` is non-null, `baseline` is non-null with a non-null `delta`, and the
baseline is not a returned point whose stored metric field/aggregation differs from the current config's, the
panel SHALL render a delta in the trend slot: ▲ with the up modifier when `delta > 0`, ▼ with the down modifier when
`delta < 0`, a flat glyph with the flat modifier when `delta == 0`; the magnitude as the absolute percent when `pct`
is non-null, else as the absolute delta formatted like the headline; followed by "vs <label>" where the label is
`7d`/`1d`/`30d`, a humanized custom duration, or "previous" for `previous_run`. The delta SHALL carry an accessible
name stating direction and window in words. No UI copy SHALL contain the phrase "previous run".

#### Scenario: Up
- **WHEN** compare is `7d`, current 1204, baseline 1075, pct 12.0
- **THEN** the panel reads "1,204" (integer format) and "▲ 12% vs 7d" with the up modifier

#### Scenario: Down
- **WHEN** pct is -8.5
- **THEN** the delta reads "▼ 8.5%" with the down modifier

#### Scenario: Flat
- **WHEN** delta is 0
- **THEN** the delta renders the flat glyph with the flat modifier and "0%"

#### Scenario: Zero baseline
- **WHEN** baseline value is 0 and current is 5 (pct null, delta 5)
- **THEN** the delta shows ▲ and the absolute "5" rather than a percent

### Requirement: Missing baseline shows when the comparison becomes available
When the server headline is shown, `compare` is a window, `baseline` is null and `availableFrom` is non-null, the
panel SHALL render a muted note
"<label> comparison available from <localized date>" instead of a delta. When `baseline` and `availableFrom` are
both null, no delta and no note SHALL be rendered.

#### Scenario: Available-from note
- **WHEN** compare is `7d`, baseline null, availableFrom 2026-10-12T09:00:00Z
- **THEN** the panel shows "7d comparison available from" followed by that date, and no ▲/▼

### Requirement: Metric sparkline from history
When the server headline is shown and the history `sparkline` holds at least two points with non-null values, the
panel SHALL render an inline sparkline (oldest to newest) using design tokens, with an accessible
name describing the trend; null-valued points and points whose stored metric field/aggregation differ from the
current config's SHALL be skipped. With fewer than two such points no sparkline renders.

#### Scenario: Sparkline renders
- **WHEN** the sparkline has 2 or more non-null points
- **THEN** a sparkline element with an accessible name is rendered in the metric panel

### Requirement: Active viewer filter hides the comparison
While a viewer control yields at least one applied row filter for the panel (an empty or unparsable control value
applies none), or a cross-filter narrows the panel's rows, the panel SHALL
show the headline computed from the filtered rows, SHALL NOT render the delta, available-from note or sparkline, and
SHALL render a muted, keyboard-focusable marker whose tooltip and accessible description read "comparison reflects
unfiltered data" — only when a comparison would otherwise have been shown.

#### Scenario: Filter hides delta
- **WHEN** a 7d delta would render and the viewer selects a dropdown control value
- **THEN** no ▲/▼ delta or sparkline is rendered and a marker with tooltip "comparison reflects unfiltered data" is

#### Scenario: Empty control value does not hide the delta
- **WHEN** a 7d delta would render and a dropdown control's value is the empty string
- **THEN** the delta still renders

### Requirement: Compare picker on metric Outputs
The Output editor SHALL offer a Compare selector for metric Outputs with None, Previous, 1 day, 7 days and 30 days,
saving `config.compare` as an explicit JSON `null` (never an omitted key), `previous_run`, `1d`, `7d` or `30d`, including
when the metric Output is created as an aggregate tail. An existing custom value SHALL be shown as a
selectable option and kept on save. Saving any Output kind SHALL preserve an existing `config.compare` the editor
does not change.

#### Scenario: Choosing 7 days persists
- **WHEN** an author selects "7 days" and saves a metric Output
- **THEN** the update payload's config contains `compare: "7d"`

#### Scenario: Choosing None clears compare
- **WHEN** a metric Output with `compare: "7d"` is saved with "None"
- **THEN** the update payload's config contains `compare: null`

#### Scenario: Chart save keeps compare
- **WHEN** a chart Output whose config has `compare: "30d"` is edited and saved
- **THEN** the saved config still contains `compare: "30d"`

### Requirement: Provenance shows the compared-with point
When a metric panel shows a delta, its provenance popover SHALL show a "Compared with" row with the baseline point's
time and its value formatted like the headline, on authenticated and public dashboards.

#### Scenario: Compared-with row
- **WHEN** a metric panel shows "▲ 12% vs 7d" and the viewer opens its provenance popover
- **THEN** the popover shows "Compared with" with the baseline's captured time and value 1,075

#### Scenario: No compared-with row under a filter
- **WHEN** the same panel has an applied viewer filter
- **THEN** the popover shows no "Compared with" row

### Requirement: Public dashboards use the public history route
On a public dashboard the metric panel SHALL read history only from the token-authorized public history route and
SHALL render the headline, delta, note, sparkline and provenance row by the same rules.

#### Scenario: Public delta
- **WHEN** a public viewer opens a shared dashboard whose metric Output has a 7d baseline
- **THEN** the panel shows the delta, fetched from `/api/dashboards/:dashboardId/panels/:panelId/history?token=`
