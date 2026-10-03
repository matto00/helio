## ADDED Requirements

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
