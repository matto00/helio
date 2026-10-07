## MODIFIED Requirements

### Requirement: Comparison resolution
The history response SHALL include `compare` (the Output's stored `config.compare`, or `null` when unset), `current`,
`baseline`, `delta`, `pct`, `availableFrom` and `sparkline`. All of these except `sparkline` SHALL be resolved over the
Output's whole retained history, independent of `limit`/`since`. `current` SHALL be the newest point, or `null` when the
Output has no history, in which case `baseline` and `availableFrom` SHALL also be `null` for every compare value. Each resolved point SHALL carry its capture time, row count
and headline value, which is the stored server-computed metric value over all rows, or `null` when the summary has
none, plus `metric`: the stored summary's metric identity `{"field": string, "agg": string|null}`, or `null` when the
summary has no metric. `metric` is a read-out of the stored record only; it SHALL NOT change which point is selected. For `previous_run`, `baseline` SHALL be the second-newest point. Because thinning never removes an Output's newest
101 points, this is the immediately previous recorded run. For a window `w` (`1d`, `7d`,
`30d` or a custom duration), `baseline` SHALL be the newest point captured at or before (`current` capture time − `w`);
because older history is thinned, that point MAY be up to one thinning bucket width (5 minutes, 1 hour or 1 day by age)
earlier than the exact target.
When no such point exists, `baseline` SHALL be `null` and `availableFrom` SHALL be the earliest point's capture time
plus `w`. `delta` SHALL be current value minus baseline value, and `pct` SHALL be `delta / |baseline value| × 100`.
Each is `null` whenever either value is null, the baseline value is zero (for `pct`), or the result is not finite.
`sparkline` SHALL list exactly the returned `points` (after `limit`/`since`) as capture time and headline value,
oldest first. Every nullable field SHALL be
present on the wire as an explicit `null`, never omitted.

#### Scenario: Window baseline is the nearest point at or before the target
- **WHEN** an Output with `compare: "7d"` has points at T−9d, T−8d, T−6d and T, and T is the newest point
- **THEN** `baseline` is the T−8d point, `delta` and `pct` are computed against it, and `availableFrom` is null

#### Scenario: A point exactly at the window boundary is the baseline
- **WHEN** an Output with `compare: "7d"` has its newest point at T, a point captured exactly at T − 7d (to the
  microsecond), and an older point 1 microsecond before that
- **THEN** `baseline` is the point at exactly T − 7d, not the older point, and `delta` and `pct` are computed against it

#### Scenario: No baseline yet
- **WHEN** an Output with `compare: "7d"` has points only at T−3d and T
- **THEN** `baseline` is `null`, `delta` and `pct` are `null`, and `availableFrom` is T−3d plus 7 days

#### Scenario: previous_run after thinning is the literal previous run
- **WHEN** an Output with `compare: "previous_run"` recorded runs one minute apart and the retention pass has run
- **THEN** `baseline` is the run captured immediately before the newest point, not an older bucket survivor

#### Scenario: previous_run
- **WHEN** an Output with `compare: "previous_run"` has points at T−2h, T−1h and T
- **THEN** `baseline` is the T−1h point
- **WHEN** it has only one point
- **THEN** `baseline` and `availableFrom` are `null`

#### Scenario: No compare configured
- **WHEN** an Output has no `config.compare`
- **THEN** `compare`, `baseline`, `delta`, `pct` and `availableFrom` are `null`, and `current` is still the newest point

#### Scenario: limit narrows the sparkline but not the comparison
- **WHEN** an Output with `compare: "7d"` has points at T−9d, T−8d, T−6d and T, and `limit=1` is requested
- **THEN** `points` and `sparkline` hold only the T point, while `baseline` is still the T−8d point

#### Scenario: Empty history
- **WHEN** an Output with any `compare` value has no history points
- **THEN** `current`, `baseline`, `delta`, `pct` and `availableFrom` are `null` and `points` and `sparkline` are empty

#### Scenario: Zero baseline
- **WHEN** the baseline's headline value is 0 and the current value is 5
- **THEN** `delta` is 5 and `pct` is `null`

#### Scenario: Resolved points carry their stored metric identity
- **WHEN** the newest point stored `metric: {field: "amount", agg: "sum", value: 12}` and the 7d baseline stored `metric: {field: "region", agg: "sum", value: 0}`
- **THEN** `current.metric` is `{field: "amount", agg: "sum"}`, `baseline.metric` is `{field: "region", agg: "sum"}`, and `baseline`/`delta`/`pct` are resolved exactly as for any other point

#### Scenario: Baseline older than the returned points carries its identity
- **WHEN** a `30d` compare resolves to a baseline point older than the 30 points returned by a default-`limit` read
- **THEN** `baseline.metric` still reports that point's stored identity, so a client can compare it with the current config without the point being in `points`
