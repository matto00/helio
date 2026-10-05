# output-history-api Specification

## Purpose
Lets clients read an Output's recorded run history and its resolved comparison (current value, baseline, delta,
percentage change and sparkline) against the Output's chosen `compare` window, on both authenticated and public
dashboard surfaces.

## Requirements

### Requirement: Authenticated history read
The backend SHALL expose `GET /api/outputs/:id/history?limit=&since=` returning the Output's history points newest
first. `limit` SHALL default to 30 and SHALL be an integer in 1..100; any other value SHALL be rejected with 400 and
never clamped. `since`, when present, SHALL be an ISO-8601 instant, and only points captured at or after it SHALL be
returned. A malformed `since` SHALL be rejected with 400. Each point SHALL carry its capture time, run id (explicit
`null` when none), trigger source, row count and stored summary. The route SHALL be readable by the Output's owner and
by grantees of its pipeline, and SHALL return 404 with a body identical to an unknown id for any other authenticated
caller.

#### Scenario: Owner reads history newest first
- **WHEN** the owner requests history for an Output with three recorded points
- **THEN** the response is 200 with the three points ordered newest first

#### Scenario: since and limit narrow the points
- **WHEN** `limit=2` is requested for an Output with five points
- **THEN** only the two newest points are returned
- **WHEN** `since` names an instant between the second- and third-newest points
- **THEN** only the two newest points are returned

#### Scenario: Out-of-range or malformed parameters
- **WHEN** `limit` is 0, 101 or non-numeric, or `since` is not an ISO-8601 instant
- **THEN** the response is 400

#### Scenario: Grantee can read
- **WHEN** a user the pipeline is shared with requests the history, through a role that does not bypass row-level
  security
- **THEN** the response is 200

#### Scenario: Non-grantee gets an indistinguishable 404
- **WHEN** an authenticated user with no access to the pipeline requests the history of a real Output
- **THEN** the response is 404 with the same status and body as a request for a nonexistent Output id

### Requirement: Comparison resolution
The history response SHALL include `compare` (the Output's stored `config.compare`, or `null` when unset), `current`,
`baseline`, `delta`, `pct`, `availableFrom` and `sparkline`. All of these except `sparkline` SHALL be resolved over the
Output's whole retained history, independent of `limit`/`since`. `current` SHALL be the newest point, or `null` when the
Output has no history, in which case `baseline` and `availableFrom` SHALL also be `null` for every compare value. Each resolved point SHALL carry its capture time, row count
and headline value, which is the stored server-computed metric value over all rows, or `null` when the summary has
none. For `previous_run`, `baseline` SHALL be the second-newest retained point. Because history is thinned with age,
this is the previous retained point, not necessarily the immediately previous run. For a window `w` (`1d`, `7d`,
`30d` or a custom duration), `baseline` SHALL be the newest point captured at or before (`current` capture time − `w`).
When no such point exists, `baseline` SHALL be `null` and `availableFrom` SHALL be the earliest point's capture time
plus `w`. `delta` SHALL be current value minus baseline value, and `pct` SHALL be `delta / |baseline value| × 100`.
Each is `null` whenever either value is null, the baseline value is zero (for `pct`), or the result is not finite.
`sparkline` SHALL list exactly the returned `points` (after `limit`/`since`) as capture time and headline value,
oldest first. Every nullable field SHALL be
present on the wire as an explicit `null`, never omitted.

#### Scenario: Window baseline is the nearest point at or before the target
- **WHEN** an Output with `compare: "7d"` has points at T−9d, T−8d, T−6d and T, and T is the newest point
- **THEN** `baseline` is the T−8d point, `delta` and `pct` are computed against it, and `availableFrom` is null

#### Scenario: No baseline yet
- **WHEN** an Output with `compare: "7d"` has points only at T−3d and T
- **THEN** `baseline` is `null`, `delta` and `pct` are `null`, and `availableFrom` is T−3d plus 7 days

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

### Requirement: Bounded query count
Serving either history route SHALL issue a number of executed database statements, counted across both connection
pools from the moment the route receives an already-authenticated (or anonymous) caller, that does not grow with the
number of stored history points. The count excludes session/token authentication, which precedes every route and is
independent of history. The count SHALL be at most 7 for the authenticated route (Output lookup 2, config lookup 2,
history 3) and at most 9 for the public route for an anonymous caller on a publicly shared dashboard (dashboard owner
resolution 1, public-grant check 1, panel listing 2, Output lookup 1, config lookup 1, history 3).

#### Scenario: History size does not change the statement count
- **WHEN** the same history request is served for an Output with 3 points and for one with 150 points
- **THEN** both issue the same number of executed statements, at or below that route's bound

### Requirement: Public history read is allow-listed
The backend SHALL expose `GET /api/dashboards/:dashboardId/panels/:panelId/history?limit=&since=&token=` with the same
dashboard-level sharing gate and panel-on-this-dashboard resolution as the other public panel routes. It SHALL return
the same comparison resolution, but its points SHALL carry only capture time, row count and stored summary, never run
ids, trigger sources, owner ids or any full-row payload. Parameter validation SHALL match the authenticated route.

#### Scenario: Anonymous viewer of a public dashboard
- **WHEN** an unauthenticated caller requests the history of an Output panel on a publicly shared dashboard
- **THEN** the response is 200 and contains no run id, trigger source or owner id

#### Scenario: Gate failures are 404
- **WHEN** the dashboard is not visible to the caller, or the panel is not on that dashboard, or the panel is not an Output
  panel, or its Output no longer exists
- **THEN** the response is 404
