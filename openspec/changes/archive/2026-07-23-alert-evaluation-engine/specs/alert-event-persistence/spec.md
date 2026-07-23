## ADDED Requirements

### Requirement: Privileged internal resolve for the evaluation engine
`AlertEventRepository` SHALL expose `resolveInternal(ruleId: AlertRuleId): Future[Option[
AlertEvent]]` running through `withSystemContext` (RLS bypass), for a background/system-context
caller with no request user. It SHALL look up the active (non-resolved) event for `ruleId` via
`findActiveByRule`, which returns rows in state `firing`, `acknowledged`, or `snoozed` (only
`resolved` rows are excluded). If the active event's state is `firing` or `acknowledged`, it
SHALL route the update through `AlertEventStateMachine.transition(existing,
AlertEventAction.Resolve)` — never a raw field update — and persist the result, returning
`Some(resolved)`. If the active event's state is `snoozed`, it SHALL NOT call `transition` (the
state machine does not accept `Resolve` from `Snoozed`) and SHALL leave the row unmodified,
returning `None`. If no active event exists, it SHALL return `None` without writing.

#### Scenario: Active firing event — resolves
- **WHEN** `resolveInternal(ruleId)` is called for a rule with an active `firing` `AlertEvent`
- **THEN** that event transitions to `state = resolved` with `resolvedAt` set, and the method
  returns `Some(resolved)`

#### Scenario: Active acknowledged event — resolves
- **WHEN** `resolveInternal(ruleId)` is called for a rule whose active event is `acknowledged`
- **THEN** that event transitions to `state = resolved` with `resolvedAt` set

#### Scenario: Active snoozed event — left untouched, not resolved
- **WHEN** `resolveInternal(ruleId)` is called for a rule whose active event is `snoozed`
- **THEN** the event's state and `snoozedUntil` remain unchanged, no row is written, and the
  method returns `None`

#### Scenario: No active event — no-op
- **WHEN** `resolveInternal(ruleId)` is called for a rule with no active (non-resolved) event
- **THEN** no row is written and the method returns `None`
