# alert-event-persistence Specification

## Purpose
Durable, owner-scoped storage of alert events — the `alert_events` Flyway schema, RLS owner
scoping, and repository access patterns (owner-scoped and privileged) that the alert evaluation
engine and delivery pipeline build on.
## Requirements
### Requirement: alert_events schema and migration
The system SHALL provide a Flyway migration (V61) creating an `alert_events` table with columns
for `id`, `alert_rule_id` (FK -> `alert_rules(id)` `ON DELETE CASCADE`), `owner_id` (FK ->
`users(id)`), `target_data_type_id`, `value` (jsonb), `pipeline_run_id` (nullable text),
`severity`, `state` (`CHECK` constrained to `firing`/`resolved`/`acknowledged`/`snoozed`),
`first_fired_at`, `last_evaluated_at`, `resolved_at` (nullable), `acknowledged_at` (nullable), and
`snoozed_until` (nullable), plus an index on `(alert_rule_id, state)`.

#### Scenario: Migration creates the table
- **WHEN** Flyway applies the alert-events migration to a fresh database
- **THEN** an `alert_events` table exists with the specified columns and the
  `(alert_rule_id, state)` index

#### Scenario: Deleting a rule cascades its events
- **WHEN** an `alert_rules` row is deleted and `alert_events` rows reference it
- **THEN** those `alert_events` rows are deleted as well

### Requirement: RLS owner scoping on alert_events
The `alert_events` table SHALL have `ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` enabled,
with a single `alert_events_owner` USING policy restricting access to rows whose `owner_id`
matches `current_setting('app.current_user_id')::uuid`, consistent with the direct-owner pattern
used for `alert_rules`.

#### Scenario: Owner can read their own event
- **WHEN** a query runs inside `withUserContext(ownerId)` for an event owned by `ownerId`
- **THEN** the event is returned

#### Scenario: Non-owner cannot read another user's event
- **WHEN** a query runs inside `withUserContext(otherUserId)` for an event owned by a different
  user
- **THEN** the event is not returned (empty result, not an error)

### Requirement: Owner-scoped repository operations
`AlertEventRepository` SHALL expose owner-scoped `findAll(ownerId, stateFilter?)`,
`findByIdOwned(id, user)`, and `applyTransition(id, action, user)` operations running through
`withUserContext`, subject to RLS.

#### Scenario: findByIdOwned excludes non-owned rows
- **WHEN** `findByIdOwned(eventOwnedByUserB, userA)` is called
- **THEN** the result is empty/not found, not the other user's event

#### Scenario: findAll filters by state
- **WHEN** `findAll(ownerId, Some("firing"))` is called and the owner has events in multiple states
- **THEN** only events matching the filter (including expired-snooze events treated as firing) are
  returned

### Requirement: Privileged internal upsert for the evaluation engine
`AlertEventRepository` SHALL expose `findActiveByRule(ruleId)` and `upsertFiringInternal(ruleId,
ownerId, targetDataTypeId, value, pipelineRunId, severity)` running through `withSystemContext`
(RLS bypass), implementing the de-duplication contract for a background/system-context caller with
no request user. When an active row exists, `upsertFiringInternal` SHALL route the update through
`AlertEventStateMachine.transition(existing, ReFire(value, severity, pipelineRunId))` uniformly —
never a raw field update — so the resulting `state`/timestamp behavior is exactly what the
`alert-event-state-machine` capability's `ReFire` requirement defines, covering all three
reachable active states (`firing`, `acknowledged`, `snoozed`).

#### Scenario: No active event — creates a new firing event
- **WHEN** `upsertFiringInternal` is called for a rule with no active (non-resolved) event
- **THEN** a new `AlertEvent` row is inserted with `state = firing`, `firstFiredAt =
  lastEvaluatedAt = now`, and `acknowledgedAt`/`resolvedAt`/`snoozedUntil` all absent

#### Scenario: Active firing event — updates in place
- **WHEN** `upsertFiringInternal` is called for a rule that already has an active `firing` event
- **THEN** the existing row's `value`, `severity`, and `last_evaluated_at` are updated and no new
  row is created

#### Scenario: Active acknowledged event — updates in place
- **WHEN** `upsertFiringInternal` is called for a rule whose active event is `acknowledged`
- **THEN** the existing row's `value`, `severity`, and `last_evaluated_at` are updated, `state`
  remains `acknowledged`, `acknowledged_at` is unchanged, and no new row is created

#### Scenario: Active snoozed event, not yet expired — updates in place
- **WHEN** `upsertFiringInternal` is called for a rule whose active event is `snoozed` with
  `snoozed_until` still in the future
- **THEN** the existing row's `value`, `severity`, and `last_evaluated_at` are updated, `state`
  remains `snoozed`, `snoozed_until` is unchanged, and no new row is created

#### Scenario: Active snoozed event past expiry — flips to firing
- **WHEN** `upsertFiringInternal` is called for a rule whose active event is `snoozed` with
  `snoozed_until` in the past
- **THEN** the existing row transitions to `state = firing`, `snoozed_until` is cleared, and
  `last_evaluated_at`/`value`/`severity` are updated

