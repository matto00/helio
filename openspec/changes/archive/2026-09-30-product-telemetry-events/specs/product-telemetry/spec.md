## Purpose

First-party product telemetry stored in Helio's own Postgres: an allow-listed per-user event log, daily aggregate rollups that outlive the per-user rows, and a fire-and-forget client helper.

## ADDED Requirements

### Requirement: Allow-listed event ingestion
`POST /api/events` SHALL require authentication and accept a batch of at most 25 events, each `{event, properties, occurredAt?}`. The server MUST reject the whole request with 400 when any event name is not in the client-emittable allow-list, when any property key is not allow-listed for that event, when a property value has the wrong type or range, or when the batch is empty or oversized. `signup_completed` SHALL NOT be client-emittable.

#### Scenario: Unknown event rejected
- **WHEN** an authenticated user posts an event named `page_viewed`
- **THEN** the response is 400 and no row is stored

#### Scenario: Unknown property rejected
- **WHEN** an authenticated user posts `provenance_opened` with any property key (none are allow-listed)
- **THEN** the response is 400 and no row is stored

#### Scenario: Client cannot forge signup
- **WHEN** a client posts `signup_completed`
- **THEN** the response is 400

#### Scenario: Valid batch stored
- **WHEN** an authenticated user posts a valid batch
- **THEN** each event is stored owned by that user and the response is 2xx

### Requirement: Per-user isolation
Stored events SHALL be visible only to their owning user at the database layer (row-level security, enforced under the non-BYPASSRLS production role). This change SHALL add no read endpoint for events.

#### Scenario: Cross-user invisibility
- **WHEN** user A has stored events and a session scoped to user B queries `product_events` as a non-superuser role
- **THEN** zero of A's rows are returned

### Requirement: Signup event
`AuthService.register`, and `AuthService.completeOAuth` when it creates a new user (Google signup), SHALL record one `signup_completed` event for the new user, server-side, at creation time. A returning Google login SHALL NOT record one.

#### Scenario: Registration records signup
- **WHEN** a user registers
- **THEN** exactly one `signup_completed` row exists for that user

#### Scenario: Google signup records the event
- **WHEN** a user is created through the Google OAuth path
- **THEN** exactly one `signup_completed` row exists for that user, and a later Google login adds none

### Requirement: First dashboard rendered, once per user
`first_dashboard_rendered` SHALL be emitted by the client when a dashboard view has rendered at least one output panel whose data has loaded with at least one row. The server SHALL store at most one such event per user (first wins), so reloads, multiple tabs, and retries create no duplicates.

#### Scenario: Duplicate dropped
- **WHEN** the same user submits `first_dashboard_rendered` twice (or from two tabs)
- **THEN** exactly one row exists and both requests succeed

#### Scenario: Empty panel does not count
- **WHEN** a dashboard renders only panels with zero rows or non-output panels
- **THEN** no `first_dashboard_rendered` is emitted

### Requirement: Time-to-first-dashboard definition
TTFD for a user SHALL equal `first_dashboard_rendered.occurred_at - signup_completed.occurred_at` in seconds. Users with no `signup_completed` (registered before this shipped) SHALL be excluded from TTFD; no backfill from `users.created_at` is performed. A negative difference is excluded.

#### Scenario: Pre-ship user excluded
- **WHEN** a user has `first_dashboard_rendered` but no `signup_completed`
- **THEN** that user contributes no TTFD sample

### Requirement: Daily rollups
The system SHALL maintain, per UTC day, the count of events per event name, distinct active users (for DAU/WAU), and weekly active users (distinct users across all events in the trailing 7 UTC days), template-choice counts (firstrun_template_chosen.template, allow-listed values or `other`), and a TTFD distribution (sample count, median via continuous percentile, p90, fixed-bound histogram) for users whose first dashboard fell on that day. Rollup computation SHALL be idempotent and recomputable for a day from that day's rows.

#### Scenario: Counts from fixtures
- **WHEN** fixture events exist across several days and the rollup runs
- **THEN** per-day per-event counts and the TTFD median and p90 equal the values computed by hand from the fixtures

#### Scenario: Template counts survive purge
- **WHEN** `firstrun_template_chosen` events are rolled up and then purged
- **THEN** per-template daily counts remain, with unknown slugs bucketed as `other`

#### Scenario: Rerun is idempotent
- **WHEN** the rollup runs twice over the same data
- **THEN** rollup rows are unchanged

### Requirement: Retention
Per-user event rows older than the retention window (default 90 days; a driver default, configurable) SHALL be purged, except `signup_completed` and `first_dashboard_rendered` (one timestamp-only row per user, retained so TTFD and once-per-user dedupe stay correct; removed only with the user), only for days already covered by the rollup; rollup rows SHALL be retained. The purge SHALL take the current time as an injectable input. Deleting a user SHALL remove that user's event rows.

#### Scenario: Purge with injected time
- **WHEN** the purge runs with an injected clock 91 days after a fixture event
- **THEN** that event row is gone and its day's rollup remains

#### Scenario: Unrolled day not purged
- **WHEN** a row is past the window but its day has not been rolled up
- **THEN** the day is rolled up before the row is purged

### Requirement: Rate limiting
`POST /api/events` SHALL have its own per-user rate limit, independent of the general `/api` limiter, returning 429 with `Retry-After` when exceeded.

#### Scenario: Limit exceeded
- **WHEN** a user exceeds the configured request budget in a window
- **THEN** the response is 429 with `Retry-After`

### Requirement: Client track helper
The frontend SHALL expose one typed `track(event, props)` that never blocks rendering, batches events offline-tolerantly (retained and retried when the network is unavailable), and swallows errors, logging at most once.

#### Scenario: Events never cross users
- **WHEN** events were queued by user A and user B is signed in at flush time
- **THEN** A's events are discarded and never sent under B's session

#### Scenario: Once-per-user flag follows confirmed delivery
- **WHEN** a `first_dashboard_rendered` delivery fails or is rejected
- **THEN** the client does not mark it delivered and may re-emit it later (server dedupe keeps one row)

#### Scenario: Failure is silent
- **WHEN** the events request fails
- **THEN** no exception reaches the caller, one console warning is logged in total, and UI is unaffected

#### Scenario: Provenance open tracked
- **WHEN** a provenance popover opens for an authenticated user
- **THEN** `provenance_opened` is tracked

#### Scenario: Public view not tracked
- **WHEN** a provenance popover opens in the unauthenticated public share view
- **THEN** nothing is sent and no error occurs
