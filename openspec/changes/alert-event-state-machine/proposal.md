## Why

HEL-447 shipped alert *rule* definitions, but a rule breach today has nowhere durable to land.
The evaluation engine (separate ticket) and delivery/UI epics (HEL-432/HEL-433) both need a
persistent, de-duplicated event with a well-defined lifecycle to read and mutate. This change
builds that event model and state machine, independent of what raises or delivers events.

## What Changes

- Add `AlertEvent` domain model + `AlertEventId` value class with lifecycle timestamps
  (`firstFiredAt`, `lastEvaluatedAt`, `resolvedAt?`, `acknowledgedAt?`, `snoozedUntil?`).
- Add a single-source-of-truth state machine (`firing → resolved`, `firing → acknowledged`,
  `firing → snoozed → firing`) rejecting illegal transitions with a `ServiceError`.
- Add Flyway migration V61 (`alert_events` table): FK to `alert_rules`, owner-scoped RLS, index on
  `(alert_rule_id, state)`.
- Add `AlertEventRepository` (Slick): owner-scoped CRUD/list plus privileged `*Internal` upsert path
  for the background engine, mirroring `AlertRuleRepository`'s pattern from HEL-447.
- Add `AlertEventService` (`Either[ServiceError, _]`) implementing dedup (one active event per rule)
  and owner-scoped ack/snooze/resolve.
- Add `AlertEventRoutes` under `/api/alerts` (list w/ `?state=`, get, acknowledge, snooze, resolve),
  `AlertEventProtocol` formatters, schema/spec updates.

## Capabilities

### New Capabilities

- `alert-event-state-machine`: the `AlertEvent` domain model, legal-transition state machine, and
  dedup contract (one active event per rule).
- `alert-event-persistence`: the `alert_events` Flyway schema, RLS owner scoping, and
  `AlertEventRepository` (owner-scoped + privileged internal upsert).
- `alert-event-api`: REST contract for `/api/alerts` (list/get/acknowledge/snooze/resolve).

### Modified Capabilities

(none — `alert-rule-persistence` and `alert-rule-crud-api` are unchanged; this change only adds a
new FK-referencing table and consumes `AlertRuleId`)

## Impact

- New files: `backend/src/main/scala/com/helio/domain/` (AlertEvent additions to `model.scala`),
  `backend/src/main/resources/db/migration/V61__alert_events.sql`,
  `backend/src/main/scala/com/helio/infrastructure/AlertEventRepository.scala`,
  `backend/src/main/scala/com/helio/services/AlertEventService.scala`,
  `backend/src/main/scala/com/helio/api/routes/AlertEventRoutes.scala`,
  `backend/src/main/scala/com/helio/api/protocols/AlertEventProtocol.scala`.
- Modified: `ApiRoutes.scala` (compose new routes), `JsonProtocols.scala` (import formatters),
  `schemas/` (new alert-event schemas), `openspec/specs/` (new capability specs on archive).
- No frontend changes (UI is HEL-433, out of scope). No changes to `AlertRuleRepository`/`Service`
  beyond reading `AlertRuleId` as a foreign key target.
