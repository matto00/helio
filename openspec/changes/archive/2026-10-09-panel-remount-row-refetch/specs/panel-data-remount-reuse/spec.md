## Purpose

Keep dashboard panel cards from re-requesting rows and Output metadata they already hold when they remount (for example
when the grid swaps between the desktop grid and the phone stack), without ever showing data older than a write or a
pipeline run the client knows about.

## ADDED Requirements

### Requirement: Remounted panel cards reuse recently fetched rows

A panel card that mounts while the client already holds a successfully fetched rows window for the same panel, the same
bound Output, and the exact query the mount would issue, not invalidated since,
SHALL render that window without issuing a new rows request, provided the card was on screen within the last 30
seconds and the client holds a completed-run baseline for the bound pipeline. When a request for that exact query is already in flight,
the mount SHALL NOT issue a second one. Manual refresh, polling and run-triggered refresh SHALL still always fetch.

#### Scenario: Crossing the desktop/phone boundary does not refetch rows

- **WHEN** a dashboard with N output-bound panels has loaded its rows and the grid container crosses the 768px boundary
  in either direction
- **THEN** zero `GET /api/outputs/:id/rows` requests are issued by the remounted cards

#### Scenario: Tables with persisted sort/filter defaults and active viewer controls do not refetch

- **WHEN** a panel whose table has a persisted sort or filter default, or whose dashboard has an active viewer control,
  has loaded its rows and the grid container crosses the 768px boundary
- **THEN** zero rows requests are issued for it and its rows still match its displayed sort/filter controls

#### Scenario: A failed load is not reused

- **WHEN** the panel's most recent rows request failed (for example with a rate-limit error) and the card remounts
- **THEN** the card issues a rows request, shows its loading state while it is pending, and shows an error (not an
  empty state) if it fails

#### Scenario: Reading the dashboard for a long time does not defeat reuse

- **WHEN** the dashboard has been on screen for more than 30 seconds and the container then crosses the boundary
- **THEN** zero rows and zero metadata requests are issued by the remounted cards

#### Scenario: Returning after leaving for more than 30 seconds refetches

- **WHEN** the user leaves the dashboard for more than 30 seconds and returns
- **THEN** the cards fetch rows and metadata as they do today

#### Scenario: A different query still fetches

- **WHEN** the query the mount would issue differs from the query the cached window was fetched under
- **THEN** the mount issues a rows request for its own query

#### Scenario: The detail view still fetches its own query

- **WHEN** the panel detail view is opened over a card whose rows were fetched under a different query
- **THEN** the detail view fetches its own query

#### Scenario: Refresh always fetches

- **WHEN** the user presses Refresh, a poll interval elapses, or a run-succeeded event arrives for a mounted panel
- **THEN** a rows request is issued even if a fresh cached window exists

### Requirement: Output metadata is shared, merged and bounded

Output metadata (`GET /api/outputs/:id`) SHALL be fetched at most once per Output for any set of concurrent consumers,
and a consumer that mounts while a non-invalidated result is held for an Output that was on screen within the last 30
seconds SHALL use it without a request. A failed fetch
SHALL NOT be cached.

#### Scenario: Remount reuses metadata

- **WHEN** panel cards remount across the desktop/phone boundary
- **THEN** zero `GET /api/outputs/:id` requests are issued for Outputs whose metadata is already held

#### Scenario: Concurrent consumers share one request

- **WHEN** several consumers of the same Output mount at the same time with nothing cached
- **THEN** exactly one `GET /api/outputs/:id` request is issued for that Output

### Requirement: Writes and runs invalidate reused data

An Output update or delete, a write to the Output's pipeline, or a successful run of that pipeline observed by the client
SHALL invalidate the held metadata and rows for the affected Outputs, so the next mount fetches fresh data.

#### Scenario: Output edit then remount shows fresh metadata

- **WHEN** an Output's config or kind is changed through the app and its panel then remounts
- **THEN** the panel issues a fresh metadata request and renders the edited configuration

#### Scenario: A run that succeeded while no card was mounted is picked up on remount

- **WHEN** rows were fetched, the cards unmounted, the bound pipeline's run succeeded without this client observing it,
  and the cards remount within 30 seconds
- **THEN** a rows request is issued and the new rows render

#### Scenario: Pipeline re-run then remount shows fresh rows

- **WHEN** a pipeline run succeeds and a panel bound to one of its Outputs then remounts
- **THEN** the panel issues a fresh rows request and renders the new rows

### Requirement: Rate limiter unchanged

This capability SHALL be achieved entirely client-side; the server rate limit and its configuration SHALL NOT change.

#### Scenario: Limiter configuration untouched

- **WHEN** the change is reviewed
- **THEN** no file under the backend rate-limiting package or its configuration is modified
