## MODIFIED Requirements

### Requirement: Metric headline uses the server all-rows value when it matches the current config
A metric panel SHALL display the latest history point's server-computed value (`current.value`) as its headline
when no viewer filter is active, the history response has a non-null `current.value`, and the newest history
point's `summary.metric.field` and `summary.metric.agg` equal the field and aggregation the current Output config
resolves to under the server's selection rule. While a server-applied row filter (a viewer control filter, or a
cross-filter applied by the server) narrows the panel, the panel SHALL instead display the full-filtered-set metric
value returned with that filtered row request when its `field`/`agg` equal the current resolution, and SHALL NOT
aggregate only the loaded rows. A cross-filter applied client-side to the loaded rows SHALL use the loaded-rows value,
labelled as computed over the loaded rows when not every row is loaded.
Owner ruling (HEL-1326 escalation, 2026-10-06, `existing-disclosure`): the HEL-588 disclosure "N of M loaded rows match." satisfies "labelled as computed over the loaded rows". A metric
whose config resolves to no field SHALL display no value. Otherwise the panel SHALL display the value computed from
the loaded rows exactly as before this change.

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

#### Scenario: Filtered headline beyond the first page
- **WHEN** a sum metric's viewer filter matches 500 rows, the panel has loaded the first 200, and the filtered rows response's `metric.value` is 4200 while the loaded rows sum to 1700
- **THEN** the headline shows 4200

#### Scenario: Removing the filter drops the filtered value
- **WHEN** the viewer filter is cleared and the next first-page rows response carries no `metric`
- **THEN** the headline no longer shows the previous filtered value

#### Scenario: Client-side cross-filter over truncated rows is labelled
- **WHEN** a metric panel is narrowed by a client-side cross-filter and not every row is loaded
- **THEN** the headline is the loaded-rows value and the "N of M loaded rows match." disclosure renders under the panel

#### Scenario: Lone label mapping shows no value
- **WHEN** a metric Output's only mapping is `label` and it has no `aggregation.value`
- **THEN** the panel shows no metric value instead of a value computed over the label column

### Requirement: Metric delta shows direction, magnitude and comparison window
When the server headline is shown, `compare` is non-null, `baseline` is non-null with a non-null `delta`, and the
baseline's stored metric field/aggregation (its own `metric` identity, whether or not it is among the returned points)
equals the current config's (when a response carries no baseline identity, the baseline
is instead judged by its stored identity among the returned points, as before), the
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

#### Scenario: Out-of-window baseline from an earlier field
- **WHEN** compare is `30d`, the baseline is not among the returned points, and its `metric` identity is `{field: "region", agg: "sum"}` while the config resolves to `amount`/`sum`
- **THEN** no delta is rendered

### Requirement: Active viewer filter hides the comparison
While a viewer control yields at least one applied row filter for the panel (an empty or unparsable control value
applies none), or a cross-filter narrows the panel's rows, the panel SHALL
show the filtered headline as defined by "Metric headline uses the server all-rows value when it matches the
current config", SHALL NOT render the delta, available-from note or sparkline, and
SHALL render a muted, keyboard-focusable marker whose tooltip and accessible description read "comparison reflects
unfiltered data" — only when a comparison would otherwise have been shown.

#### Scenario: Filter hides delta
- **WHEN** a 7d delta would render and the viewer selects a dropdown control value
- **THEN** no ▲/▼ delta or sparkline is rendered and a marker with tooltip "comparison reflects unfiltered data" is

#### Scenario: Empty control value does not hide the delta
- **WHEN** a 7d delta would render and a dropdown control's value is the empty string
- **THEN** the delta still renders
