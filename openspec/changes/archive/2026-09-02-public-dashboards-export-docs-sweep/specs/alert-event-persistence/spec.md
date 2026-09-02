## MODIFIED Requirements

### Requirement: Privileged internal upsert for the evaluation engine
`AlertEventRepository` SHALL expose `findActiveByRule(ruleId)` and `upsertFiringInternal(ruleId,
ownerId, targetOutputId, value, pipelineRunId, severity)` running through `withSystemContext`
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

