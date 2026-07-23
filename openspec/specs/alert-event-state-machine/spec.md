# alert-event-state-machine Specification

## Purpose
The `AlertEvent` domain model and its single-source-of-truth lifecycle state machine
(`firing`/`resolved`/`acknowledged`/`snoozed`), including the de-duplication contract that
guarantees at most one active event per alert rule.
## Requirements
### Requirement: AlertEvent domain model
The system SHALL define an `AlertEvent` domain model with `id: AlertEventId`,
`alertRuleId: AlertRuleId`, `ownerId: UserId`, `targetDataTypeId: DataTypeId`, `value: JsValue` (the
evaluated value that triggered/updated the event), `pipelineRunId: Option[String]`,
`severity: Severity`, `state` (one of `firing`/`resolved`/`acknowledged`/`snoozed`),
`firstFiredAt: Instant`, `lastEvaluatedAt: Instant`, `resolvedAt: Option[Instant]`,
`acknowledgedAt: Option[Instant]`, and `snoozedUntil: Option[Instant]`.

#### Scenario: Model round-trips all fields
- **WHEN** an `AlertEvent` is constructed with every optional field populated
- **THEN** each field is preserved unchanged through repository insert and read-back

### Requirement: Single-source-of-truth transition function
The system SHALL provide `AlertEventStateMachine.transition(event: AlertEvent, action:
AlertEventAction): Either[ServiceError, AlertEvent]` as the only place legal state transitions —
and every `value`/`severity`/timestamp mutation, including re-observations that don't change
`state` — are encoded; no caller SHALL mutate an `AlertEvent`'s persisted fields by any path other
than `transition`. `AlertEventAction` SHALL be a closed set: `Acknowledge`, `Snooze(until:
Instant)`, `Resolve`, `ReFire(value: JsValue, severity: Severity, pipelineRunId:
Option[String])` (a breach re-observed against an event that is already active — i.e. not
`resolved`).

`ReFire` SHALL be legal from every active state (`firing`, `acknowledged`, `snoozed`) and SHALL
always refresh `lastEvaluatedAt`, `value`, and `severity` to the values passed with the call,
leaving `firstFiredAt` untouched:
- From `firing`: `state` remains `firing`.
- From `acknowledged`: `state` remains `acknowledged`; `acknowledgedAt` is unchanged. An
  acknowledgement means a human has seen the event, not that the underlying value has stopped
  being re-observed.
- From `snoozed` with `snoozedUntil` still in the future: `state` remains `snoozed`;
  `snoozedUntil` is unchanged.
- From `snoozed` with `snoozedUntil` in the past: `state` becomes `firing`; `snoozedUntil` is
  cleared to `None`.
`ReFire` has no legal edge from `resolved` — a breach against a resolved event is not a `ReFire`,
it is the trigger for opening a new event (see the De-duplication requirement below).

#### Scenario: firing -> acknowledged
- **WHEN** `transition` is called with a `firing` event and `Acknowledge`
- **THEN** the result is `Right` with `state = acknowledged` and `acknowledgedAt` set to the
  transition time

#### Scenario: firing -> snoozed
- **WHEN** `transition` is called with a `firing` event and `Snooze(until)`
- **THEN** the result is `Right` with `state = snoozed` and `snoozedUntil = until`

#### Scenario: firing -> resolved
- **WHEN** `transition` is called with a `firing` event and `Resolve`
- **THEN** the result is `Right` with `state = resolved` and `resolvedAt` set to the transition time

#### Scenario: acknowledged -> resolved
- **WHEN** `transition` is called with an `acknowledged` event and `Resolve`
- **THEN** the result is `Right` with `state = resolved` and `resolvedAt` set

#### Scenario: snoozed (expired) -> firing via ReFire
- **WHEN** `transition` is called with a `snoozed` event whose `snoozedUntil` is in the past and
  `ReFire(value, severity, pipelineRunId)`
- **THEN** the result is `Right` with `state = firing`, `snoozedUntil` cleared, and
  `lastEvaluatedAt`/`value`/`severity` updated to the values passed with the call

#### Scenario: snoozed (not expired) -> snoozed via ReFire updates in place
- **WHEN** `transition` is called with a `snoozed` event whose `snoozedUntil` is in the future and
  `ReFire(value, severity, pipelineRunId)`
- **THEN** the result is `Right` with `state` unchanged (`snoozed`), `snoozedUntil` unchanged, and
  `lastEvaluatedAt`/`value`/`severity` updated to the values passed with the call

#### Scenario: firing -> firing via ReFire updates in place
- **WHEN** `transition` is called with a `firing` event and `ReFire(value, severity,
  pipelineRunId)`
- **THEN** the result is `Right` with `state` unchanged (`firing`) and `lastEvaluatedAt`/`value`/
  `severity` updated to the values passed with the call — no new event is created by this call

#### Scenario: acknowledged -> acknowledged via ReFire updates in place
- **WHEN** `transition` is called with an `acknowledged` event and `ReFire(value, severity,
  pipelineRunId)`
- **THEN** the result is `Right` with `state` unchanged (`acknowledged`), `acknowledgedAt`
  unchanged, and `lastEvaluatedAt`/`value`/`severity` updated to the values passed with the call

#### Scenario: ReFire never touches firstFiredAt
- **WHEN** `transition` is called with any active event and `ReFire`, regardless of resulting state
- **THEN** `firstFiredAt` on the result is identical to `firstFiredAt` on the input event

#### Scenario: Illegal transition — resolve then acknowledge
- **WHEN** `transition` is called with a `resolved` event and `Acknowledge`
- **THEN** the result is `Left(ServiceError.Conflict(...))` and the event is unchanged

#### Scenario: Illegal transition — snooze a resolved event
- **WHEN** `transition` is called with a `resolved` event and `Snooze(until)`
- **THEN** the result is `Left(ServiceError.Conflict(...))` and the event is unchanged

#### Scenario: Illegal transition — acknowledge a snoozed event
- **WHEN** `transition` is called with a `snoozed` event and `Acknowledge`
- **THEN** the result is `Left(ServiceError.Conflict(...))` and the event is unchanged

#### Scenario: Illegal transition — resolve a resolved event
- **WHEN** `transition` is called with a `resolved` event and `Resolve`
- **THEN** the result is `Left(ServiceError.Conflict(...))` and the event is unchanged

#### Scenario: Illegal transition — ReFire a resolved event
- **WHEN** `transition` is called with a `resolved` event and `ReFire`
- **THEN** the result is `Left(ServiceError.Conflict(...))` and the event is unchanged (a breach
  against a resolved event opens a *new* event via the repository's insert branch — it is never
  routed through `transition` on the resolved row)

### Requirement: De-duplication contract
The system SHALL guarantee at most one *active* (non-resolved) `AlertEvent` per `alertRuleId` at
any time. A breach while an active event already exists — regardless of whether that event is
currently `firing`, `acknowledged`, or `snoozed` — SHALL update that event in place via `ReFire`
(`lastEvaluatedAt`/`value`/`severity` always refreshed; `state` additionally flips from `snoozed`
to `firing` when `snoozedUntil` has passed) rather than creating a second row. A breach with no
active event (none ever existed, or the prior one is `resolved`) SHALL create a new `firing` event.

#### Scenario: Re-breach while firing updates in place
- **WHEN** a rule breaches twice with no intervening resolution
- **THEN** exactly one `AlertEvent` row exists for that rule, with `lastEvaluatedAt` reflecting the
  second breach

#### Scenario: Re-breach while acknowledged updates in place
- **WHEN** a rule's active event is acknowledged and the rule breaches again before it is resolved
- **THEN** exactly one `AlertEvent` row exists for that rule, still `acknowledged`, with
  `lastEvaluatedAt`/`value` reflecting the later breach

#### Scenario: Re-breach while snoozed (not expired) updates in place
- **WHEN** a rule's active event is snoozed with `snoozedUntil` in the future and the rule breaches
  again before that timestamp passes
- **THEN** exactly one `AlertEvent` row exists for that rule, still `snoozed` with the original
  `snoozedUntil`, and `lastEvaluatedAt`/`value` reflecting the later breach

#### Scenario: Breach after resolve opens a new event
- **WHEN** a rule's active event is resolved and the rule breaches again afterward
- **THEN** a second, distinct `AlertEvent` row exists for that rule with a new `firstFiredAt`

### Requirement: Snooze expiry
A `snoozed` event whose `snoozedUntil` is in the future SHALL be excluded from the active/firing
view. Once `snoozedUntil` has passed, the event SHALL be treated as `firing` again — both by the
filtered list view (`?state=firing`) and, on the next breach/re-evaluation touching that rule, by
the persisted `state` column flipping back to `firing` via `ReFire`.

#### Scenario: Future snooze excluded from firing list
- **WHEN** an event is `snoozed` with `snoozedUntil` in the future and the owner requests
  `GET /api/alerts?state=firing`
- **THEN** that event is not included in the response

#### Scenario: Expired snooze included in firing list
- **WHEN** an event is `snoozed` with `snoozedUntil` in the past and the owner requests
  `GET /api/alerts?state=firing`
- **THEN** that event is included in the response

#### Scenario: Expired snooze flips to firing on next breach
- **WHEN** an event is `snoozed` with `snoozedUntil` in the past and the rule breaches again
  (`ReFire` via the privileged upsert path)
- **THEN** the event's persisted `state` becomes `firing` and `snoozedUntil` is cleared

