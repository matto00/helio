## MODIFIED Requirements

### Requirement: Aggregates from rollups only
The response SHALL contain signups per day, TTFD median and p90 per day with sample count (new users only), first-run funnel counts (file dropped, dashboard created, first dashboard rendered), template choice counts, provenance opens per day, daily/weekly active users per day, and an all-time `totals` object. Data SHALL be read from the rollup tables, with one exception: `totals.totalUsers` SHALL be a single count of registered users (the `users` table) excluding the fixed system user `00000000-0000-0000-0000-000000000001`. The endpoint SHALL NOT scan `product_events` and the response SHALL NOT contain any user identifier.

#### Scenario: Numbers match real events
- **WHEN** events are ingested via the real write path and the real rollup runs
- **THEN** the endpoint returns exactly the counts those events imply

#### Scenario: Total users excludes the system user
- **WHEN** 8 users exist, created 53 to 166 days before `rolled_through`, plus the system user, each with a `signup_completed` event
- **THEN** `totals.totalUsers` is 8, independent of the requested `days`

#### Scenario: Response stays identifier-free
- **WHEN** the owner calls the endpoint with users and events present
- **THEN** no user id, email or other per-user value appears anywhere in the response body

## ADDED Requirements

### Requirement: All-time active-user totals
`totals.activeLast7Days` and `totals.activeLast30Days` SHALL be the number of distinct users with any tracked product event in the trailing 7 and 30 UTC days ending at `rolled_through`, read from that day's active-users rollup row. Each SHALL be `null` when that day's value is not available (not yet rolled up, or the window had left raw-event retention before the day was rolled). `totals.asOf` SHALL equal `rolled_through`. When nothing has been rolled up, both active counts and `asOf` SHALL be `null` while `totalUsers` is still returned.

#### Scenario: Active counts from the rollup
- **WHEN** fixture users emit events on known days and the real rollup runs through `rolled_through`
- **THEN** `activeLast7Days` and `activeLast30Days` equal the hand-counted distinct users in those trailing windows

#### Scenario: Not yet computable
- **WHEN** the `rolled_through` row has no 30-day value
- **THEN** `activeLast30Days` is `null`, never 0

### Requirement: Usage window range
`days` SHALL accept integers 1 to 365 inclusive and default to 30 when absent. A non-numeric value or one outside 1..365 SHALL be rejected with `400` and SHALL NOT be clamped. The owner check SHALL run before `days` is parsed.

#### Scenario: Longest window accepted
- **WHEN** the owner requests `days=365`
- **THEN** the response is 200 with 365 zero-filled days per series

#### Scenario: Over the cap rejected
- **WHEN** the owner requests `days=366`
- **THEN** the response is 400

### Requirement: Usage page totals and data-through date
The admin usage page SHALL show an all-time totals card (total users, active in the last 7 days, active in the last 30 days) that is independent of the selected window, labelling the active counts as users with a tracked product event rather than general app use, and rendering a `null` count as unavailable rather than 0. The window selector SHALL offer 7, 30, 90, 180 and 365 days. The page SHALL show the data-through date (`rolled_through`, UTC) prominently with a note that the most recent days are not yet rolled up.

#### Scenario: Totals visible at any window
- **WHEN** the owner opens the page with users who signed up before the selected window
- **THEN** the totals card still shows the all-time user count

#### Scenario: Data-through date shown
- **WHEN** usage has been rolled up
- **THEN** the page states the data-through date and that the latest days are still pending
