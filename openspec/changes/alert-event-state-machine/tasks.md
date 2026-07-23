## 1. Backend: domain model + state machine

- [x] 1.1 Add `AlertEventId(value: String) extends AnyVal` and `AlertEvent` case class to
      `backend/src/main/scala/com/helio/domain/model.scala` (fields per design.md: `id`,
      `alertRuleId`, `ownerId`, `targetDataTypeId`, `value: JsValue`, `pipelineRunId:
      Option[String]`, `severity`, `state`, `firstFiredAt`, `lastEvaluatedAt`,
      `resolvedAt/acknowledgedAt/snoozedUntil: Option[Instant]`).
- [x] 1.2 Add `AlertEventState` sealed trait (`Firing`/`Resolved`/`Acknowledged`/`Snoozed`) with
      `fromString`/`asString`, mirroring `Severity`'s pattern.
- [x] 1.3 Add `AlertEventAction` sealed trait (`Acknowledge`, `Snooze(until: Instant)`, `Resolve`,
      `ReFire(value: JsValue, severity: Severity, pipelineRunId: Option[String])`) to `model.scala`.
- [x] 1.4 Implement `AlertEventStateMachine.transition(event, action): Either[ServiceError,
      AlertEvent]` (new file `backend/src/main/scala/com/helio/domain/AlertEventStateMachine.scala`)
      encoding every legal edge from design.md — including all four `ReFire` branches
      (`firing`/`acknowledged`/unexpired-`snoozed` refresh `value`/`severity`/`lastEvaluatedAt` in
      place; expired-`snoozed` additionally flips `state` to `firing` and clears `snoozedUntil`;
      `firstFiredAt` is never touched by `ReFire`) — and rejecting all other edges (including
      `ReFire` from `resolved`) with `ServiceError.Conflict`.

## 2. Backend: migration + repository

- [x] 2.1 Re-verify next available Flyway version by listing
      `backend/src/main/resources/db/migration/` (expected V61; confirm no sibling change landed
      first).
- [x] 2.2 Write `V61__alert_events.sql`: table per design.md, FK to `alert_rules` `ON DELETE
      CASCADE`, `CHECK` on `state`, index on `(alert_rule_id, state)`, RLS
      (`ENABLE`/`FORCE ROW LEVEL SECURITY` + `alert_events_owner` policy) mirroring V60.
- [x] 2.3 Implement `AlertEventRepository` (`backend/src/main/scala/com/helio/infrastructure/`):
      Slick table/row mapping (jsonb `value` via the `jsonbStringType` pattern from
      `AlertRuleRepository`), owner-scoped `findAll(ownerId, stateFilter)`, `findByIdOwned(id,
      user)`, `applyTransition(id, action, user)`.
- [x] 2.4 Implement privileged `findActiveByRule(ruleId)` and `upsertFiringInternal(ruleId,
      ownerId, targetDataTypeId, value, pipelineRunId, severity)` on `withSystemContext`,
      implementing the dedup contract per design.md: if no active row, `INSERT` a new `firing` row;
      if an active row exists in **any** active state (`firing`, `acknowledged`, or `snoozed` —
      expired or not), route it through `AlertEventStateMachine.transition(existing,
      ReFire(value, severity, pipelineRunId))` and persist the result unconditionally — do **not**
      hand-branch on state in the repository; let `transition` decide whether `state` stays put or
      flips `snoozed -> firing`. Add a justification comment at the privileged-bypass callsite per
      `rls-privileged-bypass` convention (no real caller yet — HEL-466 wires it).

## 3. Backend: service + routes

- [x] 3.1 Implement `AlertEventService` (`backend/src/main/scala/com/helio/services/`):
      `findAll(user, stateFilter)`, `findById(id, user)`, `acknowledge(id, user)`, `snooze(id,
      snoozedUntil, user)`, `resolve(id, user)` — each does owner-scoped
      `findByIdOwned` then `AlertEventStateMachine.transition` then persists via
      `applyTransition`.
- [x] 3.2 Add `AlertEventProtocol` request/response formatters
      (`backend/src/main/scala/com/helio/api/protocols/`): `SnoozeAlertEventRequest { snoozedUntil
      }`, `AlertEventResponse` JSON shape.
- [x] 3.3 Implement `AlertEventRoutes` (`backend/src/main/scala/com/helio/api/routes/`): `GET /`
      (`?state=`), `GET /:id`, `POST /:id/acknowledge`, `POST /:id/snooze`, `POST /:id/resolve`
      under `/api/alerts`, mirroring `AlertRuleRoutes`'s thin-route shape. Map
      `ServiceError.Conflict` to 409.
- [x] 3.4 Compose `AlertEventRoutes` into `ApiRoutes.scala`; register formatters in
      `JsonProtocols.scala`.
- [x] 3.5 Add `schemas/alert-event.schema.json` and `schemas/snooze-alert-event-request.schema.json`
      (JSON Schema 2020-12, mirroring the `alert-rule.schema.json` shape).

## 4. Tests

- [x] 4.1 `AlertEventStateMachineSpec` (or equivalent unit test file): full transition matrix —
      every legal edge persists correct timestamps, including all four `ReFire` branches
      (`firing->firing`, `acknowledged->acknowledged`, `snoozed->snoozed` when not expired,
      `snoozed->firing` when expired — each asserting `lastEvaluatedAt`/`value`/`severity` refresh
      and `firstFiredAt` unchanged), and every illegal edge from the spec's scenarios (including
      `ReFire` on a `resolved` event) is rejected with `ServiceError.Conflict`.
- [x] 4.2 `AlertEventRepositorySpec`: dedup across all three active states — re-breach while
      `firing` updates in place, re-breach while `acknowledged` updates in place without changing
      `state`/`acknowledgedAt`, re-breach while `snoozed` (not expired) updates in place without
      changing `state`/`snoozedUntil`, re-breach while `snoozed` (expired) flips to `firing` and
      clears `snoozedUntil`, breach-after-resolve opens a new event — plus RLS owner scoping (owner
      reads own rows, cross-owner reads empty) and cascade delete from `alert_rules`.
- [x] 4.3 `AlertEventServiceSpec`: acknowledge/snooze/resolve happy paths persist correct
      timestamps; illegal transitions return `Left(Conflict)`; cross-user operations return
      `NotFound`/`Forbidden`.
- [x] 4.4 `AlertEventRoutesSpec`: all 5 endpoints, `?state=` filtering (including expired-snooze
      included in `firing`), 409 on illegal transition, 403/404 on cross-user, 404 on unknown id.
- [x] 4.5 Run `sbt test` and confirm the full suite is green (including pre-existing
      `AlertRuleRepositorySpec`/`AlertRuleServiceSpec`/`AlertRuleRoutesSpec`/`RlsPolicyGuardSpec`
      unaffected).
