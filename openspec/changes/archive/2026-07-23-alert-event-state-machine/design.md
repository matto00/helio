## Context

Second ticket of the sequential 3-ticket alerts chain (HEL-447 -> HEL-455 -> HEL-466). HEL-447
(merged, 76a1071d) shipped `AlertRule`/`AlertRuleId`/`Severity`/`Comparator` domain types, the
`alert_rules` table (V60) with direct-owner RLS, `AlertRuleRepository` (owner-scoped + privileged
`listEnabledByDataTypeInternal`), `AlertRuleService`, and `/api/alert-rules`. This ticket follows
the exact same pattern (domain model in `model.scala`, Slick repo, `Either[ServiceError, _]`
service, thin routes) for `AlertEvent`, adding one FK-child table. Next Flyway version confirmed
at scheduling time: **V61** (main's highest is V60__alert_rules.sql).

## Goals / Non-Goals

**Goals:**
- `AlertEvent` domain model + lifecycle timestamps, single-source-of-truth state machine.
- Dedup contract: one active (non-resolved) event per rule — re-breach updates in place; breach
  after resolve opens a new event.
- Owner-scoped repository/service/routes for ack/snooze/resolve, plus a privileged `*Internal`
  upsert path for the (not-yet-built) evaluation engine.

**Non-Goals:**
- Producing events from rule evaluation (HEL-466 wires the engine callsite).
- Delivering events over any channel (HEL-432) or the management UI (HEL-433).
- Auto-transitioning `snoozed -> firing` when `snoozedUntil` passes as a background job — the
  acceptance criterion is satisfied by an **exclusion-at-read** approach (see Decisions) rather
  than a scheduled sweep, since no engine/scheduler exists yet in this ticket's scope.

## Decisions

- **Table shape**: `alert_events(id, alert_rule_id, owner_id, target_data_type_id, value,
  pipeline_run_id NULL, severity, state, first_fired_at, last_evaluated_at, resolved_at NULL,
  acknowledged_at NULL, snoozed_until NULL)`. `alert_rule_id` FK -> `alert_rules(id)`
  `ON DELETE CASCADE` (an event for a deleted rule is meaningless, mirrors `alert_rules`'s own FK
  to `data_types`). `owner_id` is denormalized onto the row (copied from the rule at creation)
  rather than joined through `alert_rule_id` — this keeps the RLS policy a direct-owner check
  (consistent with the `alert_rules` / `pipelines` / `data_types` pattern in `rls-owner-tables`)
  instead of a subquery-based indirect policy, and avoids an extra join on every list/ack/snooze
  call. `pipeline_run_id` is a plain nullable `TEXT` column (no FK) — pipeline runs are ephemeral
  execution records; the ticket only requires the id be captured, not referentially enforced.
- **`state` as a TEXT enum + CHECK constraint**: `firing` / `resolved` / `acknowledged` / `snoozed`,
  mirroring `severity`'s `CHECK (... IN (...))` pattern on `alert_rules` rather than a Postgres
  native enum type (no native enum precedent exists in this schema).
- **State machine as one function**: `AlertEventStateMachine.transition(event: AlertEvent, action:
  AlertEventAction): Either[ServiceError, AlertEvent]` in `domain/` (not a service method) — single
  source of truth referenced by both `AlertEventService` (routes) and the dedup-upsert path
  (`AlertEventRepository`/`Service` for engine breaches), so illegal transitions can't diverge
  between the two callers, and so **every** value/timestamp mutation — not just user-driven ones —
  goes through `transition`, with no raw-field-update bypass anywhere. `AlertEventAction` is a small
  closed sealed trait (`Acknowledge`, `Snooze(until: Instant)`, `Resolve`, `ReFire(value: JsValue,
  severity: Severity, pipelineRunId: Option[String])` — a breach re-observed against an event that
  is already active).

  **`ReFire` is legal from every active state** (`firing`, `acknowledged`, and `snoozed`), because
  the dedup contract ("two breaches with no intervening resolution yield exactly one active event
  with updated `lastEvaluatedAt`") is not qualified to only apply while `firing` — a user
  acknowledging or snoozing an event does not stop the underlying condition from being re-observed,
  it only changes how that event is surfaced/delivered. `ReFire`'s effect depends on the event's
  current state, resolved entirely inside `transition` (no branching in the repository/service):
  - `firing -> firing`: unchanged state; `lastEvaluatedAt`, `value`, and `severity` are refreshed
    to the values passed with this `ReFire` (`severity` reflects the *evaluated* severity of the
    most recent breach, exactly like `value` — see the rationale below).
  - `acknowledged -> acknowledged`: unchanged state, unchanged `acknowledgedAt`; `lastEvaluatedAt`,
    `value`, and `severity` refreshed. An acknowledgement is a human's "I've seen this," not a
    claim that the underlying value has stopped changing.
  - `snoozed -> snoozed` (when `snoozedUntil` is still in the future): unchanged state, unchanged
    `snoozedUntil`; `lastEvaluatedAt`, `value`, and `severity` refreshed. The snooze intentionally
    keeps suppressing delivery even though the underlying data point moved.
  - `snoozed -> firing` (when `snoozedUntil` has passed): transitions to `firing`, clears
    `snoozedUntil`; `lastEvaluatedAt`, `value`, and `severity` refreshed. This is the mechanism that
    satisfies "snoozed returns to firing" (see the exclusion-at-read Decision below) — `transition`
    itself performs the expiry check (`Instant.now().isAfter(event.snoozedUntil)`) rather than the
    caller pre-branching on it, keeping that logic in the single source of truth.
  - `resolved` has **no** legal `ReFire` edge — `resolved` is terminal (see below); a breach against
    a resolved event is not a `ReFire` at all, it is "no active event," handled by the insert branch
    below.

  **`severity` refresh policy**: `severity` is refreshed on every legal `ReFire`, identically to
  `value` — both represent "what the most recent evaluation observed," not "what was true when the
  event first opened." (`firstFiredAt`'s snapshot of the *original* severity is preserved implicitly
  by the fact that `firstFiredAt` itself is never touched by `ReFire`, only by initial insert.)
  `Acknowledge`/`Snooze`/`Resolve` never touch `value`/`severity` — those are user actions on the
  existing observation, not new observations.

  Other legal edges: `firing -> {resolved, acknowledged, snoozed}`; `acknowledged -> resolved`;
  every other edge (e.g. `resolved -> *`, `snoozed -> acknowledged`) rejected with
  `ServiceError.Conflict`. `resolved` is terminal — a new event is what dedup opens next, not a
  transition out of `resolved`.
- **Dedup / upsert path**: `AlertEventRepository.upsertFiringInternal(ruleId, ownerId,
  targetDataTypeId, value, pipelineRunId, severity)` (privileged, `withSystemContext`, mirrors
  `AlertRuleRepository.listEnabledByDataTypeInternal`'s pre-caller-landing pattern — HEL-466 wires
  the real caller) implements the dedup contract at the repository layer: `findActiveByRule(ruleId)`
  first; if an active (non-resolved) row exists **in any active state** (`firing`, `acknowledged`,
  or `snoozed` — expired or not), call `AlertEventStateMachine.transition(existing,
  ReFire(value, severity, pipelineRunId))` and persist the result unconditionally — the state
  machine (not the repository) decides whether that leaves `state` unchanged or flips
  `snoozed -> firing`, per the `ReFire` rules above; if no active row exists (none, or the prior one
  is `resolved`), `INSERT` a new `firing` row (`firstFiredAt = lastEvaluatedAt = now`,
  `acknowledgedAt`/`resolvedAt`/`snoozedUntil` all `None`). "Active" = `state != 'resolved'`.
- **Snooze-expiry exclusion at read, not a sweep**: `findActiveByRule` / the owner-scoped list
  endpoint (`?state=firing`) treat a `snoozed` row whose `snoozedUntil` has passed as effectively
  `firing` for filtering purposes (`state = 'firing' OR (state = 'snoozed' AND snoozed_until <
  now())`), and `upsertFiringInternal`'s re-breach path physically flips it back to `firing` on the
  next evaluation (see above) — this satisfies "excluded from active delivery until the timestamp
  passes, then returns to firing" without introducing a cron/scheduler, which is out of scope for
  this storage-only ticket. Documented as the mechanism in `alert-event-state-machine`'s spec so
  HEL-466 (which drives re-evaluation) doesn't need to invent this independently.
- **RLS**: mirror `alert_rules_owner` — `FORCE ROW LEVEL SECURITY`, single `alert_events_owner`
  USING policy on `owner_id = current_setting('app.current_user_id')::uuid`.
- **Index**: `idx_alert_events_rule_state ON alert_events(alert_rule_id, state)` for
  `findActiveByRule`, per the ticket's explicit ask.
- **Routes**: `AlertEventRoutes` under `/api/alerts` — `GET /` (`?state=`), `GET /:id`, `POST
  /:id/acknowledge`, `POST /:id/snooze` (body `{ snoozedUntil }`), `POST /:id/resolve`. Owner-scoped
  `findByIdOwned` + `AlertEventStateMachine.transition` in the service, matching
  `AlertRuleService`'s ACL-then-mutate shape. Cross-user access returns 404 (existence not leaked,
  same ACL-triad convention `AlertRuleService`/`findByIdOwned` already uses).

## Risks / Trade-offs

- [Risk] Denormalized `owner_id`/`target_data_type_id` on `alert_events` could drift from the
  parent `alert_rules` row if a rule is ever reassigned. -> Mitigation: `alert_rules` has no
  update path for `ownerId`/`targetDataTypeId` today (`AlertRuleService.update` only touches
  metric/condition/name/enabled/severity), so drift is not currently reachable; if that changes,
  a follow-up ticket must address cascading the update.
- [Risk] Exclusion-at-read for snooze expiry means a `snoozed` event whose timestamp has passed
  but that nothing re-evaluates (no engine yet) will show as excluded via the `?state=firing` list
  filter but its persisted `state` column will still literally say `snoozed` until the next
  breach/read-path touches it. -> Mitigation: acceptable for this storage-only ticket per the
  acceptance criterion's wording ("excluded from active delivery... then returns to firing") —
  the filtered list view is the observable contract; a spec scenario covers the filtered-list
  case explicitly so the test suite pins this behavior rather than requiring a physical flip on
  passive read.
- [Risk] `ReFire` action name overloads "firing" for four distinct outcomes (in-place refresh from
  `firing`, `acknowledged`, or unexpired `snoozed`; state flip from expired `snoozed`) — could be
  confusing to a future reader. -> Mitigation: doc comment on `AlertEventAction.ReFire` in
  `model.scala` spells out all four branches explicitly, and `AlertEventStateMachineSpec`'s
  transition matrix (tasks.md 4.1) has one scenario per branch so the behavior is pinned by tests,
  not just prose.
- [Risk] Refreshing `severity` on every `ReFire` means a transient severity spike/dip that
  self-corrects between evaluations is visible in the persisted row, even while the event is
  `acknowledged` or `snoozed` (i.e. even though the user isn't being actively notified of it).
  -> Mitigation: acceptable — `lastEvaluatedAt`/`value` already carry this same "most recent
  observation, not most recent notification" semantics per the ticket's dedup contract, and
  `firstFiredAt` remains untouched by `ReFire` as the stable "when did this event first open" audit
  timestamp.

## Migration Plan

Standard Flyway forward-only migration (V61); additive table, no data migration. Rollback = revert
the migration file per existing project convention (no automated down migrations in this repo).

## Open Questions

- None blocking. The snooze-expiry mechanism (read-time exclusion + upsert-time flip) is an
  implementation-time decision within the ticket's stated constraint, not left ambiguous.

## Planner Notes

- Self-approved: `pipeline_run_id` as a plain unenforced `TEXT` column (no FK), since pipeline
  runs are not modeled as a durable referenceable table in this codebase today (per grep of
  `PipelineRunService.scala` / `pipelines` schema at planning time) and the ticket only asks that
  the id be captured for traceability.
- Self-approved: snooze-expiry via read-time exclusion + upsert-time flip rather than introducing
  a background scheduler — no scheduler infrastructure exists yet in this codebase, and adding one
  would be scope creep beyond a storage-only ticket whose engine callsite is explicitly HEL-466.
- Self-approved (design-gate round 1 revision): `ReFire` is legal from every active state
  (`firing`, `acknowledged`, `snoozed`), not just `firing`, with `severity` refreshed alongside
  `value`/`lastEvaluatedAt` on every legal `ReFire`. The ticket's dedup AC ("two breaches... yield
  exactly one active event with updated `lastEvaluatedAt`") is not qualified to only apply while
  `firing` — extending `ReFire` to `acknowledged`/`snoozed` is the reading that keeps that AC true
  unconditionally, and routes every mutation through `transition` with zero raw-field-update
  bypasses, preserving the single-source-of-truth guarantee stated above. The alternative (a raw
  repository-level update for those two states) was rejected because it would have silently
  violated "single source of truth" for illegal-transition rejection.
