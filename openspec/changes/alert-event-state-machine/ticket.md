# HEL-455: Alert event model + state machine + persistence (firing/resolved/acknowledged/snoozed)

## Context

Greenfield alerting. When the evaluation engine (separate ticket) checks a rule after a pipeline run completes in `PipelineRunService.onRunSuccess` (`backend/src/main/scala/com/helio/services/PipelineRunService.scala`), a breach must produce a durable, de-duplicated alert *event* with a lifecycle — not a fire-and-forget log line. Delivery (HEL-432) and the management UI (HEL-433) both read and mutate these events. This ticket owns the event model + its state machine, independent of what raises or delivers events.

## Batch context (from human, orchestrator-level)

This is ticket 2 of a strictly sequential 3-ticket alerts chain (HEL-447 → HEL-455 → HEL-466). HEL-447 is already MERGED to main (PR #265, squash commit 76a1071d) — it shipped the `alert_rules` table (V60), `AlertRuleId`/`Severity`/`Comparator` domain types, `AlertRuleRepository` (including the privileged `listEnabledByDataTypeInternal` reserved for the engine), `AlertRuleService`, and `/api/alert-rules`. This worktree is branched from current main (76a1071d) so all of that is present.

The `alert_events` migration FKs `alert_rules`. Verified next available Flyway version at scheduling time: **V61** (main's highest is V60__alert_rules.sql from HEL-447).

## Scope

* Domain model in `backend/src/main/scala/com/helio/domain/`: `AlertEvent` case class + `AlertEventId(value: String) extends AnyVal`, referencing `alertRuleId: AlertRuleId`, `ownerId: UserId`, `targetDataTypeId: DataTypeId`, the evaluated value, the triggering `pipelineRunId` (optional), `severity`, and timestamps (`firstFiredAt`, `lastEvaluatedAt`, `resolvedAt?`, `acknowledgedAt?`, `snoozedUntil?`).
* State machine as a sealed trait / string enum: `firing → resolved`, `firing → acknowledged`, `firing → snoozed (until T) → firing`. Encode legal transitions in one place (a `transition(event, action): Either[ServiceError, AlertEvent]`) with rejection of illegal transitions.
* De-duplication contract: one *active* (non-resolved) event per rule. A re-breach while already firing updates `lastEvaluatedAt`/value in place (does not create a duplicate); a breach after resolution opens a new event. This is the idempotency key the engine relies on.
* Flyway migration **V61**: `alert_events` table, FK to `alert_rules` (cascade behavior on rule delete), owner-scoped RLS, index on `(alert_rule_id, state)` for the active-event lookup.
* Repository (Slick): `findActiveByRule(ruleId)`, `upsertFiring(...)`, `applyTransition(...)`, owner-scoped list with filtering by state, plus a privileged `*Internal` upsert path for the background engine (no request user), mirroring `PipelineRunService`'s `*Internal` usage.
* Service `AlertEventService` returning `Either[ServiceError, _]`; ack/snooze/resolve operations owner-scoped.
* REST routes `/api/alerts` (GET list with `?state=`, GET `:id`, POST `:id/acknowledge`, POST `:id/snooze` with `snoozedUntil`, POST `:id/resolve`) as a thin `AlertEventRoutes` composed into `ApiRoutes.scala`; formatters in `JsonProtocols.scala`; schemas/specs updated. No inline FQNs in Scala.

## Acceptance criteria

* State machine: every illegal transition (e.g. resolve → acknowledge, snooze a resolved event) is rejected with a `ServiceError`; every legal transition persists the correct timestamp.
* Dedup: two breaches of the same rule with no intervening resolution yield exactly one active event with updated `lastEvaluatedAt`; a breach after resolve yields a second event.
* Snooze: an event `snoozed` with `snoozedUntil` in the future is excluded from active delivery until the timestamp passes, then returns to `firing`.
* Owner scoping enforced by service + RLS; cross-user ack/snooze/resolve returns 403/404.
* ScalaTest: transition matrix (legal + illegal), dedup, snooze expiry, RLS scoping. `sbt test` green.

## Out of scope

* Producing events from rule evaluation (engine ticket wires this).
* Delivering events over any channel (HEL-432).
* UI (HEL-433).

## Dependencies

* Alert rule model + persistence (same epic) — `AlertEvent` references `AlertRuleId` and the `alert_rules` FK. (HEL-447, already merged.)

## Reference: HEL-447 patterns to mirror

* `AlertRuleId` value class, `Severity`/`Comparator` sealed traits — see `backend/src/main/scala/com/helio/domain/model.scala`.
* `AlertRuleRepository` (`backend/src/main/scala/com/helio/infrastructure/AlertRuleRepository.scala`) — Slick table, owner-scoped queries, `*Internal` privileged path pattern (`listEnabledByDataTypeInternal`).
* `AlertRuleService` (`backend/src/main/scala/com/helio/services/AlertRuleService.scala`) — `Either[ServiceError, _]` pattern.
* `AlertRuleRoutes` (`backend/src/main/scala/com/helio/api/routes/AlertRuleRoutes.scala`) + `AlertRuleProtocol` (`backend/src/main/scala/com/helio/api/protocols/AlertRuleProtocol.scala`) — thin routes + protocol formatter pattern.
* `V60__alert_rules.sql` — RLS policy pattern to mirror for `alert_events`.
* `AlertRuleRepositorySpec`, `AlertRuleServiceSpec`, `AlertRuleRoutesSpec` — test structure/patterns to mirror.
