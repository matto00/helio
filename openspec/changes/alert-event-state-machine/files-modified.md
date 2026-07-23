# Files modified — HEL-455

## Domain

- `backend/src/main/scala/com/helio/domain/model.scala` — added `AlertEventId`, `AlertEventState`
  (sealed trait, `fromString`/`asString`), `AlertEventAction` (sealed trait: `Acknowledge`,
  `Snooze`, `Resolve`, `ReFire`), and the `AlertEvent` case class.
- `backend/src/main/scala/com/helio/domain/AlertEventStateMachine.scala` — new file. Single
  source-of-truth `transition(event, action): Either[ServiceError, AlertEvent]` encoding every
  legal edge (including all four `ReFire` branches) and rejecting everything else with
  `ServiceError.Conflict`.

## Persistence

- `backend/src/main/resources/db/migration/V61__alert_events.sql` — new `alert_events` table
  (FK to `alert_rules` `ON DELETE CASCADE`, `CHECK` on `state`, owner-scoped RLS
  `alert_events_owner`, index on `(alert_rule_id, state)` + `owner_id`).
- `backend/src/main/scala/com/helio/infrastructure/AlertEventRepository.scala` — new file.
  Owner-scoped `findAll`/`findByIdOwned`/`applyTransition` (all through `withUserContext`), plus
  privileged `findActiveByRule`/`upsertFiringInternal` (through `withSystemContext`) implementing
  the dedup/upsert contract via `AlertEventStateMachine.transition`.
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — added
  `alert_events` to the `rlsTables` allowlist (CONTRIBUTING.md's "Adding a new ACL'd table" rule).

## Service + API

- `backend/src/main/scala/com/helio/services/AlertEventService.scala` — new file. `findAll`,
  `findById`, `acknowledge`, `snooze`, `resolve` — the three mutation methods delegate to
  `AlertEventRepository.applyTransition`, which performs the owner-scoped lookup + state-machine
  transition + persist as a single `withUserContext` transaction (see file-level doc comment for
  the rationale — avoids a read-then-write race across two transactions).
- `backend/src/main/scala/com/helio/api/protocols/AlertEventProtocol.scala` — new file.
  `AlertEventResponse`/`AlertEventsResponse`/`SnoozeAlertEventRequest` formatters.
- `backend/src/main/scala/com/helio/api/routes/AlertEventRoutes.scala` — new file. Thin
  `/api/alerts` routes: `GET /` (`?state=`), `GET /:id`, `POST /:id/acknowledge`,
  `POST /:id/snooze`, `POST /:id/resolve`.
- `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — added `AlertEventIdSegment`.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed in `AlertEventProtocol`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exported the new `AlertEvent*`
  protocol types into `com.helio.api` (mirrors the existing `AlertRule*` re-exports).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — added a nullable-optional
  `alertEventRepo: AlertEventRepository` constructor param (mirrors `alertRuleRepo`), wired
  `alertEventServiceOpt`, and mounted `AlertEventRoutes` into the authenticated route tree.

## Schemas

- `schemas/alert-event.schema.json` — new. Mirrors `AlertEventResponse`.
- `schemas/snooze-alert-event-request.schema.json` — new. Mirrors `SnoozeAlertEventRequest`.

## Tests

- `backend/src/test/scala/com/helio/domain/AlertEventStateMachineSpec.scala` — new. Full
  transition matrix: every legal edge (incl. all four `ReFire` branches) + every illegal edge
  from spec.md's scenarios.
- `backend/src/test/scala/com/helio/infrastructure/AlertEventRepositorySpec.scala` — new.
  Dedup/upsert across all three active states, `findActiveByRule`, owner-scoped RLS, `?state=`
  filtering (incl. expired-snooze), `applyTransition` NotFound/Conflict, cascade delete from
  `alert_rules`.
- `backend/src/test/scala/com/helio/services/AlertEventServiceSpec.scala` — new.
  Acknowledge/snooze/resolve happy paths, illegal-transition Conflict, cross-user NotFound,
  `findAll` state-filter validation + expired-snooze-as-firing.
- `backend/src/test/scala/com/helio/api/routes/AlertEventRoutesSpec.scala` — new. All 5
  endpoints, `?state=` filtering (incl. expired-snooze), 409 on illegal transition, 404 on
  unknown id, 403/404 on cross-user.

## OpenSpec

- `openspec/changes/alert-event-state-machine/tasks.md` — all 18 tasks marked complete.
