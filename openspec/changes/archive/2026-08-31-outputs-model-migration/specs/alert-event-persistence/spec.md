## MODIFIED Requirements

### Requirement: alert_events schema and migration
The system SHALL provide a Flyway migration creating an `alert_events` table with columns
for `id`, `alert_rule_id` (FK -> `alert_rules(id)` `ON DELETE CASCADE`), `owner_id` (FK ->
`users(id)`), `target_output_id` (FK -> `outputs(id)` `ON DELETE CASCADE`), `value` (jsonb),
`pipeline_run_id` (nullable text), `severity`, `state` (`CHECK` constrained to
`firing`/`resolved`/`acknowledged`/`snoozed`), `first_fired_at`, `last_evaluated_at`,
`resolved_at` (nullable), `acknowledged_at` (nullable), and `snoozed_until` (nullable), plus an
index on `(alert_rule_id, state)`. The prior `target_data_type_id` column no longer exists.

#### Scenario: Migration retargets the column
- **WHEN** the outputs-model migration runs against a database with existing `alert_events` rows
- **THEN** every event's `target_output_id` resolves to the same Output its parent rule now
  targets, and the `target_data_type_id` column no longer exists

#### Scenario: Deleting a rule cascades its events
- **WHEN** an `alert_rules` row is deleted and `alert_events` rows reference it
- **THEN** those `alert_events` rows are deleted as well

#### Scenario: Migration creates the table
- **WHEN** Flyway applies the alert-events migration to a fresh database
- **THEN** an `alert_events` table exists with the specified columns and the
  `(alert_rule_id, state)` index
