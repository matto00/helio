## MODIFIED Requirements

### Requirement: Aggregates from rollups only
The response SHALL contain signups per day, TTFD median and p90 per day with sample count (new users only), first-run funnel counts (file dropped, dashboard created, first dashboard rendered), template choice counts, provenance opens per day, daily/weekly active users per day, and an all-time `totals` object. Data SHALL be read from the rollup tables, with two exceptions: `totals.totalUsers` SHALL be a single count of registered users (the `users` table) excluding the fixed system user `00000000-0000-0000-0000-000000000001`, and `totals.storedObjectDeletionsQueued` / `totals.storedObjectDeletionsStuck` SHALL be single live counts over the stored-object deletion queue (see "Stored-object deletion queue counts"). The endpoint SHALL NOT scan `product_events` and the response SHALL NOT contain any user identifier.

#### Scenario: Numbers match real events
- **WHEN** events are ingested via the real write path and the real rollup runs
- **THEN** the endpoint returns exactly the counts those events imply

#### Scenario: Total users excludes the system user
- **WHEN** 8 users exist, created 53 to 166 days before `rolled_through`, plus the system user, each with a `signup_completed` event
- **THEN** `totals.totalUsers` is 8, independent of the requested `days`

#### Scenario: Response stays identifier-free
- **WHEN** the owner calls the endpoint with users and events present
- **THEN** no user id, email or other per-user value appears anywhere in the response body

### Requirement: Usage page totals and data-through date
The admin usage page SHALL show an all-time totals card (total users, active in the last 7 days, active in the last 30 days) that is independent of the selected window, labelling the active counts as users with a tracked product event rather than general app use, and rendering a `null` count as unavailable rather than 0. The window selector SHALL offer 7, 30, 90, 180 and 365 days. The page SHALL show the data-through date (`rolled_through`, UTC) prominently with a note that the most recent days are not yet rolled up. The page SHALL also show, separately from the all-time totals card and labelled as live, the number of stored objects queued for deletion and the number of queued deletions stuck at the retry limit, with a note that stuck rows are retried 24 hours after their last attempt.

#### Scenario: Totals visible at any window
- **WHEN** the owner opens the page with users who signed up before the selected window
- **THEN** the totals card still shows the all-time user count

#### Scenario: Data-through date shown
- **WHEN** usage has been rolled up
- **THEN** the page states the data-through date and that the latest days are still pending

#### Scenario: Deletion queue counts shown
- **WHEN** the owner opens the page while 3 deletions are queued and 1 of them is stuck at the retry limit
- **THEN** the page shows 3 queued and 1 stuck in a live storage-cleanup section, not in the all-time totals card

## ADDED Requirements

### Requirement: Stored-object deletion queue counts
`totals.storedObjectDeletionsQueued` SHALL be the number of rows currently in the stored-object deletion queue (every
row, whether due, leased, deferred or stuck). `totals.storedObjectDeletionsStuck` SHALL be the number of those rows
whose failed-attempt count has reached the drain's attempt cap (the same cap the drain uses to stop claiming a row).
Both SHALL be non-null integers, read live at request time, independent of `days` and returned whether or not anything
has been rolled up. The response SHALL NOT contain any storage key, source table, row id or other per-row value from
the queue. The counts SHALL be read with the same privileged access the drain uses, so production returns the real
counts rather than an RLS-filtered zero.

#### Scenario: Counts reflect the queue
- **WHEN** the queue holds 4 rows, 2 of which have reached the attempt cap and 1 of which has failed fewer times
- **THEN** `totals.storedObjectDeletionsQueued` is 4 and `totals.storedObjectDeletionsStuck` is 2, for any `days`

#### Scenario: Below the cap is not stuck
- **WHEN** a queued row has failed one attempt fewer than the cap
- **THEN** it is counted as queued and not as stuck

#### Scenario: Counts before any rollup
- **WHEN** nothing has been rolled up and the queue holds 1 stuck row
- **THEN** the response still carries `storedObjectDeletionsQueued` 1 and `storedObjectDeletionsStuck` 1

#### Scenario: No queue detail leaks
- **WHEN** the owner calls the endpoint while stuck rows exist
- **THEN** no storage key, source table or queue row id appears anywhere in the response body
