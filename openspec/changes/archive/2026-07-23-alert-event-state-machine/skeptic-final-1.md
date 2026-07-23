## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, all three capability specs
  (`alert-event-state-machine`, `alert-event-persistence`, `alert-event-api`), `tasks.md`,
  `files-modified.md`, `skeptic-design-1.md`, `skeptic-design-2.md`, and `evaluation-1.md` in full,
  treating the latter three as claims to independently re-verify, not fact.
- `git log --oneline main..HEAD` → single commit `fb4f8297 HEL-455 Add AlertEvent state machine +
  persistence + API`. `git diff main...HEAD --stat` → 30 files, additive (new domain/repo/service/
  routes/protocol/migration/schema/test files + mechanical composition edits to `ApiRoutes.scala`,
  `JsonProtocols.scala`, `package.scala`, `IdParsing.scala`, `RlsPolicyGuardSpec.scala`). No
  unrelated files touched.

**State machine (the round-1/round-2 design-gate-critical contract)**

- Read `backend/src/main/scala/com/helio/domain/AlertEventStateMachine.scala` in full. Confirmed
  the shipped `transition` function has four distinct `ReFire` match arms — `Firing`,
  `Acknowledged`, and `Snoozed` (with the expired/unexpired branch resolved *inside* the `Snoozed`
  arm via `Instant.now().isAfter(...)`, not pre-branched by a caller) — exactly matching the
  gate-approved design.md contract (not a narrower 2-branch version). All four refresh
  `value`/`severity`/`pipelineRunId`/`lastEvaluatedAt`; none touch `firstFiredAt`. `resolved` has no
  legal edge (falls through to the catch-all `Conflict`). No raw-field-update path exists anywhere
  in this file.
- Read `backend/src/main/scala/com/helio/domain/model.scala`'s diff — `AlertEventState`,
  `AlertEventAction` (closed sealed trait, `ReFire(value, severity, pipelineRunId)`), and
  `AlertEvent` case class match design.md's field list exactly.
- Read `backend/src/test/scala/com/helio/domain/AlertEventStateMachineSpec.scala` in full: 16
  scenarios covering all 4 legal user-driven edges, all 4 `ReFire` branches individually asserted
  (state, refreshed fields, unchanged `acknowledgedAt`/`snoozedUntil` where applicable,
  `firstFiredAt` untouched), plus 7 illegal-edge rejections including `ReFire` on `resolved`. This
  is a transition matrix, not prose — a regression to any one of the four `ReFire` branches would
  fail a named test.

**Dedup contract across all active states (not just firing)**

- Read `backend/src/main/scala/com/helio/infrastructure/AlertEventRepository.scala` in full.
  `upsertFiringInternal` selects any row with `state != 'resolved'` and routes it through
  `AlertEventStateMachine.transition(existing, ReFire(...))` unconditionally — no hand-branching on
  state in the repository, matching design.md's "single source of truth" requirement. The "should be
  unreachable" `Left` branch fails loudly (`IllegalStateException`) rather than silently dropping a
  breach.
- Read `backend/src/test/scala/com/helio/infrastructure/AlertEventRepositorySpec.scala` in full
  (347 lines): dedicated tests for re-breach while `firing`, while `acknowledged`, while `snoozed`
  (not expired), while `snoozed` (expired), and breach-after-resolve — each asserting exactly one
  row remains, `firstFiredAt`/`acknowledgedAt`/`snoozedUntil` persistence-round-tripped (not
  in-memory `Instant.now()` compared, avoiding false positives from JDBC timestamp truncation), plus
  `findActiveByRule`, RLS-scoped `findByIdOwned`/`findAll` (including expired-snoozed-as-firing
  filtering), `applyTransition` NotFound/Conflict, and cascade delete from `alert_rules`. This is
  full active-state coverage, not just the `firing` case.
- Cross-checked `specs/alert-event-persistence/spec.md` (lines 49–84) — 5 `upsertFiringInternal`
  scenarios (no-active-row, active-firing, active-acknowledged, active-snoozed-unexpired,
  active-snoozed-expired) match the round-2 design-gate revision word-for-word and match what's
  implemented and tested. No residual 2-branch gap from round 1 survived into the code.

**Service, routes, and owner scoping**

- Read `AlertEventService.scala`, `AlertEventRoutes.scala`, `AlertEventProtocol.scala` in full.
  Service methods delegate exclusively to `AlertEventRepository.applyTransition` (single
  read-transition-persist transaction, no read-then-write race); routes are thin, map
  `ServiceError.Conflict` to 409 generically via `ServiceResponse`.
- `applyTransition`/`findByIdOwned` use `WHERE id = ? AND owner_id = ?` — cross-user requests
  correctly return `ServiceError.NotFound` → 404 (existence not leaked), matching
  `CONTRIBUTING.md`'s ACL-triad "existence-not-leaked" rule and `AlertRuleService`'s established
  pattern. Ticket AC allows 403 *or* 404 — 404 is a valid choice, consistently applied.
- `AlertEventRoutesSpec.scala` (324 lines) exercises all 5 endpoints end-to-end against a real
  embedded Postgres, including `?state=` filtering (expired-snooze included/excluded correctly),
  409 on illegal transition (and confirms the row is left unmutated via a follow-up GET), 404 on
  unknown id, and 403-or-404 on cross-user for get/acknowledge/snooze/resolve.
- `AlertEventServiceSpec.scala` (251 lines) covers the same at the service layer plus `findAll`'s
  `BadRequest` on an unknown state-filter value.

**Migration + RLS**

- Read `V61__alert_events.sql` in full: table shape matches design.md exactly (`alert_rule_id` FK
  `ON DELETE CASCADE`, `owner_id UUID REFERENCES users(id)`, `state`/`severity` CHECK constraints,
  `(alert_rule_id, state)` index plus a bonus `owner_id` index not required by the ticket but
  addressing round-1's non-blocking note). `ENABLE`/`FORCE ROW LEVEL SECURITY` + single
  `alert_events_owner` USING policy on `owner_id = current_setting('app.current_user_id')::uuid`,
  mirroring V60 exactly. The privileged-bypass justification comment above `FORCE ROW LEVEL
  SECURITY` names `helio_privileged`/V34 and the specific reserved callsites
  (`findActiveByRule`/`upsertFiringInternal`), per the `rls-privileged-bypass`/ACL-triad convention
  in `CONTRIBUTING.md:58`.
- `RlsPolicyGuardSpec.scala`'s `rlsTables` allowlist now includes `"alert_events"` (line 74) — this
  is the structural regression guard (relrowsecurity/relforcerowsecurity/policy-exists in
  `pg_class`/`pg_policies`), consistent with the pattern used for every other ACL'd table in this
  codebase.
- Noted (non-blocking, pre-existing, project-wide, not introduced by this ticket): in all four new
  test files, `DbContext` is constructed with the *same* embedded-Postgres `db` for both the "app"
  and "privileged" pool, connected as the `postgres` superuser — Postgres superusers always bypass
  RLS regardless of `FORCE ROW LEVEL SECURITY`, so the "owner scoping" tests are actually exercising
  the repository's own `WHERE owner_id = ?` SQL predicates, not the Postgres RLS policy itself. This
  is the documented, accepted "RLS testing parity gap" already tracked in project memory
  (`project_rls_testing_parity_gap.md`) and mirrors the identical pattern in
  `AlertRuleRepositorySpec`/`AlertRuleServiceSpec`/`AlertRuleRoutesSpec` from the already-merged
  HEL-447. Not a regression introduced by this change; not blocking.

**Inline FQNs / CONTRIBUTING.md**

- Grepped all 6 new production files for `com.helio.` qualifiers outside the top-of-file import
  block — none found; every reference goes through a wildcard or named top-level import
  (`com.helio.domain._`, `com.helio.services.ServiceError`, etc.), consistent with
  `feedback_no_inline_fqns` and `CONTRIBUTING.md`.
- Route-boundary ID wrapping followed: `AlertEventIdSegment: PathMatcher1[AlertEventId]` added to
  `IdParsing.scala`; repository/service methods accept `AlertEventId` only.
- Per-domain JSON formatters live in `AlertEventProtocol.scala` under `com.helio.api.protocols`;
  `JsonProtocols.scala` only mixes it in (`CONTRIBUTING.md`'s formatter-aggregator rule).
- No `TODO`/`FIXME`/`XXX` anywhere in the diff (`git diff main...HEAD -- backend | grep -n
  "TODO\|FIXME\|XXX"` → empty).

**Fresh gate re-runs (all read myself, not pasted from evaluator)**

- `cd backend && sbt test` → `Tests: succeeded 1597, failed 0, canceled 0, ignored 0, pending 0` /
  `All tests passed.` (61 migrations applied including V61; includes
  `AlertEventStateMachineSpec`/`AlertEventRepositorySpec`/`AlertEventServiceSpec`/
  `AlertEventRoutesSpec`/updated `RlsPolicyGuardSpec`).
- `npm run lint` → clean, zero warnings.
- `npm run format:check` → "All matched files use Prettier code style!"
- `npm run check:schemas` → "schemas in sync with JsonProtocols (15 checked across 20 protocol
  files)".
- `npm run check:scala-quality` → "Scala code-quality check: clean (52 soft warning(s))" — all
  soft-budget file-size warnings (informational; 3 of the new test files are among them, consistent
  with ~49 other pre-existing files over budget project-wide); zero inline-FQN violations.
- `npm run check:openspec` → reports the change complete-but-unarchived, exactly the expected/
  intentional signal per this repo's two-phase workflow (archiving is a later delivery step) — not
  a defect.

**No UI to review** — `frontend/**` has zero diff (confirmed via `git diff main...HEAD --stat`);
this is a backend-only, storage-layer ticket per its own "Out of scope" section (UI is HEL-433).

### Acceptance criteria traced

1. "State machine rejects every illegal transition... every legal transition persists the correct
   timestamp" → `AlertEventStateMachine.scala` + `AlertEventStateMachineSpec.scala` (16 scenarios).
   **Met.**
2. "Dedup: two breaches... yield exactly one active event with updated `lastEvaluatedAt`; a breach
   after resolve yields a second event" → `upsertFiringInternal` + `AlertEventRepositorySpec`'s 5
   dedup scenarios (firing/acknowledged/snoozed-unexpired/snoozed-expired/after-resolve). **Met, and
   not narrowed to just the `firing` case** — the specific concern flagged in this task's brief.
3. "Snooze... excluded from active delivery until the timestamp passes, then returns to firing" →
   `findAll`'s `state=firing` read-time filter (excludes unexpired, includes expired) +
   `upsertFiringInternal`'s physical flip on next breach — both tested at repo/service/route layers.
   **Met** (via the gate-approved exclusion-at-read design, not a scheduler — correctly out of scope
   per design.md's Non-Goals).
4. "Owner scoping enforced by service + RLS; cross-user ack/snooze/resolve returns 403/404" →
   `findByIdOwned`/`applyTransition`'s `WHERE owner_id = ?` + V61's RLS policy + `ServiceError.NotFound`
   → 404, tested at repo/service/route layers. **Met.**
5. "ScalaTest: transition matrix (legal + illegal), dedup, snooze expiry, RLS scoping. `sbt test`
   green." → all four new spec files plus a fresh `sbt test` run (1597/1597). **Met.**

### Verdict: CONFIRM

The implementation matches the gate-approved design.md contract exactly — the four-branch `ReFire`
extension from design-gate round 2 (the specific risk this task's brief called out: "verify the
shipped code actually implements this fully, not a narrower 2-branch version") is genuinely present
in `AlertEventStateMachine.scala`, exercised by name in `AlertEventStateMachineSpec`, and covered
end-to-end against a real embedded Postgres in `AlertEventRepositorySpec` across all three reachable
active states, not just `firing`. No raw-field-update bypass exists — every mutation path (user-driven
via `applyTransition`, engine-driven via `upsertFiringInternal`) routes through the single
`transition` function. All five gates re-run fresh and pass. No inline FQNs. The privileged bypass
carries a proper justification comment naming the convention it follows. All ticket ACs trace to real
code and tests, not prose.

### Non-blocking notes

- The RLS "ownership" tests in all four new spec files run against the Postgres superuser role (same
  `db` used for both `withUserContext`/`withSystemContext` in test fixtures), so they exercise the
  repository's explicit `WHERE owner_id = ?` predicates rather than the actual Postgres RLS policy
  enforcement path. This is a pre-existing, already-tracked, project-wide gap (see
  `project_rls_testing_parity_gap.md`) inherited unchanged from HEL-447's identical test pattern —
  not something this ticket introduced or should be expected to fix on its own.
- `evaluation-1.md`'s non-blocking suggestion (no validation on a past `snoozedUntil` at the
  `Snooze` action/route layer) is correctly out of scope per the ticket's ACs; worth carrying into
  HEL-433 (management UI) design review as it flagged.
