## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, all three capability specs
  (`alert-event-state-machine`, `alert-event-persistence`, `alert-event-api`), and `tasks.md` in
  full.
- Cross-checked against the actual HEL-447 code on disk (not just the archived change doc):
  - `backend/src/main/resources/db/migration/V60__alert_rules.sql` — direct-owner RLS pattern
    (`ENABLE`/`FORCE ROW LEVEL SECURITY` + single `_owner` USING policy on `owner_id`), confirmed
    the V61 plan mirrors it correctly (table shape, cascade FK, RLS naming).
  - `backend/src/main/scala/com/helio/infrastructure/AlertRuleRepository.scala` — confirmed the
    `withUserContext`/`withSystemContext` split, `jsonbStringType` pattern, `findByIdOwned`
    ACL-triad convention, and the privileged `*Internal` doc-comment convention this change plans
    to reuse for `upsertFiringInternal`/`findActiveByRule`.
  - `backend/src/main/scala/com/helio/services/AlertRuleService.scala` — confirmed the
    `Either[ServiceError, _]` shape and ACL-then-mutate pattern this change's `AlertEventService`
    plans to mirror.
  - `backend/src/main/scala/com/helio/services/ServiceError.scala` and
    `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala:63` — confirmed
    `ServiceError.Conflict` already maps to 409 centrally (tasks.md 3.3's "map Conflict to 409" is
    automatic via the existing `ServiceResponse.complete`, not new wiring — non-blocking, just
    imprecise wording).
  - `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala:4` — confirmed a
    `domain -> services` import (`ServiceError`) is already precedented in this codebase, so
    `AlertEventStateMachine` (in `domain/`) returning `Either[ServiceError, AlertEvent]` is not an
    architectural violation.
  - Confirmed `users(id)` is `UUID PRIMARY KEY` via migration grep, consistent with `owner_id UUID`
    FK design for `alert_events`.
  - Confirmed `ApiRoutes.scala`/`JsonProtocols.scala` composition pattern (optional-repo injection,
    `Option(...).map(new Service(_))`, route composition) that the new routes will need to follow —
    not called out explicitly in tasks.md but a mechanical detail, not a design gap.
- Traced the state machine's "Legal edges" list in `design.md:48-51` against the dedup/upsert
  decision (`design.md:54-62`) and the persistence spec's `upsertFiringInternal` scenarios
  (`specs/alert-event-persistence/spec.md:49-67`) to check whether every reachable active-row state
  is actually covered by a specified behavior (see Change Request 1 below).

### Verdict: REFUTE

### Change Requests

1. **The dedup/upsert contract does not specify behavior for 2 of the 4 reachable "active" states,
   and the two places that describe it (design.md prose vs. tasks.md/spec.md enumeration)
   contradict each other.**

   `alert_event`'s "active" (non-resolved) states are `firing`, `acknowledged`, and `snoozed`
   (which splits into expired/not-expired for read purposes). A re-breach can hit any of these when
   `upsertFiringInternal` runs. But:

   - `design.md:48-51` ("Legal edges") makes `ReFire` legal **only** from `firing` (updates in
     place) and `snoozed` (unconditionally transitions to `firing`). There is **no legal edge for
     `acknowledged` + `ReFire`**, and the state machine itself has no concept of "expired vs.
     not-expired" snooze — that check is described as happening *before* the repository decides
     whether to invoke `transition`.
   - `design.md:54-62` ("Dedup / upsert path") separately says, in general prose: "if an active
     (non-resolved) row exists, `UPDATE ... SET value, last_evaluated_at` in place" — worded as if
     this applies uniformly to *any* active state (i.e. including `acknowledged` and
     not-yet-expired `snoozed`), with the state-machine-driven flip-to-firing called out as an
     *additional* step only for the expired-snooze sub-case.
   - `specs/alert-event-persistence/spec.md:49-67` (the actual OpenSpec requirement/scenarios — the
     artifact tests get written against) enumerates **only 3** scenarios for
     `upsertFiringInternal`: no-active-row, active-**firing**, active-**snoozed-past-expiry**. There
     is no scenario for active-**acknowledged** or active-**snoozed-not-yet-expired**.
   - `tasks.md:28-33` (task 2.4) mirrors the same 2-branch enumeration verbatim:
     "insert-if-none-active, update-in-place-**if-firing**, flip-and-update-**if-snoozed-expired**"
     — an implementer following the task checklist literally would write a match/branch on exactly
     these two named cases, leaving `acknowledged` and not-yet-expired `snoozed` unhandled (default
     branch: silently no-op, throw, or worst case duplicate-insert — any of which breaks the core
     dedup AC: "two breaches of the same rule with no intervening resolution yield exactly one
     active event with updated `lastEvaluatedAt`", which is not qualified to only apply when
     `firing`).
   - Compounding this: the "single source of truth" principle stated in `design.md:42-44` says the
     dedup-upsert path routes through `AlertEventStateMachine.transition` specifically so illegal
     transitions can't diverge between callers — but the general "update in place" prose for
     `acknowledged`/unexpired-`snoozed` rows can only be satisfied by a **raw field update that
     bypasses `transition` entirely** (since those states have no legal `ReFire` edge). This
     bypass is never stated explicitly, so it's unclear whether it's intended or an oversight.

   **Required revision**: Update `specs/alert-event-persistence/spec.md` (and mirror into
   `tasks.md` 2.4/4.2) to add explicit scenarios for the two missing branches:
   - `upsertFiringInternal` on an active **`acknowledged`** row: state, `value`,
     `last_evaluated_at`.
   - `upsertFiringInternal` on an active **`snoozed`** row whose `snoozedUntil` has **not** passed:
     state, `value`, `last_evaluated_at`, and whether `snoozedUntil` is left untouched.

   State explicitly in `design.md` whether these two branches go through
   `AlertEventStateMachine.transition` (which requires adding legal edges for them, e.g. an
   `acknowledged -> acknowledged` / `snoozed -> snoozed` in-place `ReFire` case) or via a raw
   repository-level field update that intentionally sits outside the state machine (in which case
   the "single source of truth" claim in the Decisions section needs a caveat explaining why
   value/timestamp-only touches are exempt). Either answer is implementable — the design currently
   gives two contradictory answers instead of picking one.

2. **`upsertFiringInternal`'s `severity` parameter write-time semantics are unspecified on
   update.** The signature `upsertFiringInternal(ruleId, ownerId, targetDataTypeId, value,
   pipelineRunId, severity)` takes `severity` on every call, but
   `specs/alert-event-persistence/spec.md:59-61` ("Active firing event — updates in place") only
   says `value` and `last_evaluated_at` are updated — it doesn't say whether `severity` is also
   refreshed on an in-place update (e.g. if the underlying `AlertRule`'s severity changed between
   the event's `firstFiredAt` and a later re-breach). Add a sentence to `design.md`/the spec
   scenario stating whether `severity` is refreshed on update-in-place or only set at insert time.

### Non-blocking notes

- No index is planned on `alert_events.owner_id` alone, unlike `alert_rules`'s
  `idx_alert_rules_owner_id`. The RLS-filtered `findAll(ownerId, ...)` path will filter on
  `owner_id` on every list/GET call; the current plan only indexes `(alert_rule_id, state)`. Worth
  a follow-up index if this becomes a hot path, not blocking for this storage-only ticket.
- No validation is specified for `POST /api/alerts/:id/snooze`'s `snoozedUntil` being in the future
  (a past timestamp would be silently accepted and immediately treated as expired/firing by the
  read-time exclusion filter). Not required by the ticket's ACs, but worth a one-line design note
  so the implementer doesn't have to guess whether this should be a 400.
- Tasks.md 3.3's "Map `ServiceError.Conflict` to 409" already happens automatically via the
  existing central `ServiceResponse.complete` (`ServiceResponse.scala:63`) — no new code needed
  there; harmless as written, just imprecise.
