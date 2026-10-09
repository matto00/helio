# product-telemetry Specification

## Purpose
First-party product telemetry stored in Helio's own Postgres: an allow-listed per-user event log, daily aggregate rollups that outlive the per-user rows, and a fire-and-forget client helper.

## Requirements

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

### Requirement: Client wire payload conforms to the server allow-list
The client SHALL send each product event with only the top-level fields `event`, `properties` and `occurredAt`; client-internal attribution fields such as `userId` SHALL NOT appear on the wire. A cross-boundary test SHALL run the client's real serialized payload through the server's real validator.

#### Scenario: Client batch is accepted
- **WHEN** the client flushes queued events for the signed-in user
- **THEN** `POST /api/events` returns 202 and one `product_events` row per event is stored

#### Scenario: Contract drift fails a test
- **WHEN** the client adds a new top-level field to the wire event
- **THEN** the shared-fixture test fails before merge

### Requirement: Rejected batches are surfaced
When the server rejects a batch with 400 the client SHALL drop that batch and log an error once per page-load containing the server's message; 429 and 5xx SHALL remain retryable.

#### Scenario: 400 is logged once
- **WHEN** the server answers 400 to a batch
- **THEN** the batch is removed from the queue and a single error log with the server message is emitted

### Requirement: Template slugs roll up under their own slug
The rollup of `firstrun_template_chosen` SHALL bucket each of `streamer`, `founder`, `ops`, `finance` under its own slug, and any other value under `other`.

#### Scenario: Known slug
- **WHEN** a `firstrun_template_chosen` event with template `streamer` is stored and rolled up
- **THEN** the rollup row's property value is `streamer`, not `other`

### Requirement: Historical signup backfill
The system SHALL, via migration V114, insert exactly one `signup_completed` product event with empty properties and `occurred_at` equal to `users.created_at` for every user that has none, and SHALL NOT insert `first_dashboard_rendered` events. The insert SHALL succeed when the migration runs as a non-superuser, non-BYPASSRLS role, and SHALL be idempotent.

#### Scenario: Users lacking a signup event get one
- **WHEN** V114 runs as a NOSUPERUSER NOBYPASSRLS role over users with no `signup_completed` row
- **THEN** each such user has exactly one `signup_completed` row with `occurred_at = users.created_at` and `properties = '{}'`

#### Scenario: Existing event is untouched and re-run is a no-op
- **WHEN** a user already has a `signup_completed` row, or the backfill statement is run again
- **THEN** no additional row is inserted and the existing row is unchanged

#### Scenario: No first_dashboard_rendered backfill
- **WHEN** V114 completes
- **THEN** no `first_dashboard_rendered` row was created by it

#### Scenario: History becomes visible on the first rollup tick (rolled_through null)
- **WHEN** the rollup tick runs with `rolled_through` null after the backfill
- **THEN** every day from the earliest signup through today-2 is rolled up and `rolled_through` is set

#### Scenario: History becomes visible when rolled_through was already set
- **WHEN** V114 inserts rows and `rolled_through` is non-null and not before the earliest backfilled day
- **THEN** V114 lowers `rolled_through` to the day before the earliest backfilled day, and the next tick rolls the historical days forward again

### Requirement: Monthly active users rollup
The daily active-users rollup SHALL also record, per UTC day, the number of distinct users with any product event in the trailing 30 UTC days ending that day. The value SHALL be written as `null` when the 30-day window's first day is not inside raw-event retention at rollup time (partial raw rows would under-count); a later re-roll of the same day that cannot compute it SHALL keep a value previously computed while the window was inside retention (never overwrite it with null). A computable re-roll SHALL recompute it idempotently with the rest of the day's rollup. Days rolled up before this value existed are not backfilled.

#### Scenario: Thirty-day distinct count
- **WHEN** fixture users emit events on days spread across a 30-day window and the rollup runs for its last day
- **THEN** the stored 30-day value equals the hand-counted distinct users across that window, counting a user active on several days once

#### Scenario: Not computable outside retention
- **WHEN** a day is rolled up for the first time and its 30-day window starts at or before the retention cutoff
- **THEN** its 30-day value is `null`

#### Scenario: Re-roll after the window left retention keeps the earlier value
- **WHEN** a day's 30-day value was computed inside retention and the day is re-rolled after the window's first day has left retention
- **THEN** the stored 30-day value is unchanged, not null
