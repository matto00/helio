## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS (with a coverage gap noted in Phase 2)

- All ticket ACs addressed at the code level: mutations across dashboards/panels/pipelines/data
  sources/data types/auth/tokens/MFA/patch-set-apply/proposal-apply are instrumented via
  `AuditService.record` at the service layer, one call site per public mutation method, matching
  design.md's 11 numbered Decisions verified below.
- No AC silently reinterpreted. `design.md` Decision 3 (`AuditSource.Ui` placeholder) is a
  documented, ticket-scoped simplification explicitly carved out by the ticket's own Non-Goals
  ("Distinguishing UI vs PAT vs MCP `source` values — separate attribution ticket"), not a
  reinterpretation.
- Task-by-task cross-check against tasks.md and design.md's Decisions 1–11 (spot-checked every
  call site in the diff, not just the tasks.md checkboxes):
  - Decision 2 (fire-after-success, `DashboardService.create`'s `created` flag gate) — correct
    (`DashboardService.scala:69-101`).
  - Decision 6 (MFA login-outcome split: `auth.login` / `auth.login.challenged` /
    `auth.login.failed` across `AuthService.login`, `completeOAuth`, and
    `MfaService.verifyLogin`) — correctly implemented exactly as specified, including
    `recordFailedAttempt` now threading `challenge.userId` through for metadata.
  - Decision 7 (duplicate/cascade — one row per actor-initiated call) — correct in
    `DashboardService.duplicate`/`delete` and `PanelService.duplicate`; DB-cascade panel deletes
    are not separately audited.
  - Decision 8 (data-source/data-type enumeration) — correct: every `DataSourceService.create*`
    variant and `SourceService.createSql/createRest` emit `data_source.create`; `DataTypeService`
    emits `update`/`delete` only, no `create`.
  - Decision 9 (batch_create/batch_update/contents.replace/import/BoundPanelService/AutoLayout/
    ImageUpload enumeration) — every call site in the diff matches the decision's prescribed
    action name and metadata shape exactly.
  - Decision 10 (patch-set/undo/proposal-apply fan-out accepted as N rows; the
    `DashboardProposalService.createAll` rollback branch using the new
    `DashboardService.deleteInternal` — never audited) — correctly implemented; `deleteInternal`
    is `private[services]`, doc-commented "rollback-only, do not call from a route," and the
    public `delete` is untouched.
  - Decision 11 (MFA lifecycle: `confirmEnrollment`→`auth.mfa.enable`, `disable`→
    `auth.mfa.disable`, `regenerateBackupCodes`→`auth.mfa.backup_codes.regenerate`,
    `startEnrollment` deliberately not audited) — correct.
- No scope creep: every touched file is on the ticket's route/service list or is
  `AuditTestFixture`/the new integration spec/`Main.scala`/`ApiRoutes.scala` wiring.
- No regressions to existing behavior: `AuthService.logout` now binds the actor from the found
  session instead of discarding it (`case Some(session) =>`), which is additive, not a behavior
  change to the response contract.
- No API/schema changes needed or made (audit rows are not exposed to any client contract yet —
  correctly out of scope).
- `files-modified.md`, `design.md`, `spec.md`, `tasks.md` all reflect the implemented behavior
  accurately — spec.md's scenarios map 1:1 onto the call sites reviewed above.

### Phase 2: Code Review — FAIL

**Gates (fresh run, this session, in `WORKTREE_PATH`, `CLEAN_WORKTREE` not set at this speed):**
- `cd backend && sbt compile` — success.
- `cd backend && sbt test` — `3427` tests, `0` failed, `0` canceled, all green (185s). Matches the
  executor's self-reported number.
- `node scripts/check-scala-quality.mjs` — clean; only pre-existing soft file-size warnings (the
  new `AuditMutationInstrumentationSpec.scala` at 372 lines is flagged as one of them, informational
  only per CONTRIBUTING.md, not a hard failure). No inline-FQN violations in any touched file —
  every new/changed file imports `AuditService`/`AuditSource`/`spray.json._` at the top, consistent
  with CONTRIBUTING.md's Imports & Qualifiers rule.
- No frontend files touched (`git diff --name-only main...HEAD` — 20 files, all `backend/**`), so
  the frontend gates (lint/format/test/build) are not applicable to this change.

**Code-quality findings:** no mechanical violations found. DI wiring (`ApiRoutes.scala`,
`Main.scala`) correctly follows the file's existing nullable-optional convention. Every new
`audit(...)` helper is a `private def` guarded on `auditService != null`, matching the pattern
used elsewhere in the codebase for optional collaborators. `AuditTestFixture.scala` centralizes
stub wiring per tasks.md 1.2, avoiding per-spec-file duplication (DRY).

**The FAIL is on test coverage, not code correctness.** The ticket's acceptance criterion reads:
"Performing **each mutation** via API writes exactly one audit row with correct
action/resource/actor (integration tests using the route testkit + a real/embedded audit repo)."
The shipped `AuditMutationInstrumentationSpec.scala` covers only: `dashboard.create`,
`dashboard.delete` (+cascade non-audit), `dashboard.duplicate`, `panel.create`, `panel.delete`,
`auth.register`, `auth.login`, `auth.login.failed` (secret-free metadata), and audit-write-failure
isolation. It does **not** cover, via integration test, the exact call sites that required the
most design-gate iteration to get right and that Decisions 6/9/10 exist specifically to nail down:

1. **Decision 6 — MFA-gated login split.** No integration test exercises an MFA-enrolled user's
   login: neither the `auth.login.challenged` event at the initial `AuthService.login` call, nor
   the `auth.login` event fired later from `MfaService.verifyLogin`'s `establishSession` path
   (rather than a duplicate `auth.login.challenged`), nor the `auth.login.failed` path on a bad
   MFA code. This is exactly the split the code review above confirms is *implemented* correctly
   by reading — but it is unverified by any test that would catch a regression (e.g. an accidental
   swap of which event fires from which method).
2. **Decision 9 — batch/composite call sites.** No integration test for `panel.batch_create`,
   `panel.batch_update` (row-count-not-per-item), `dashboard.import`, or
   `dashboard.contents.replace`. These are the call sites the round-2/round-3 design gate rounds
   added after finding gaps in a first pass — the same failure mode (a missed or mis-shaped call
   site) is exactly what integration coverage here would catch and unit-level code reading cannot
   fully rule out (e.g. an off-by-one on `resource_id` = dashboard id vs. first panel id, or a
   count computed from the wrong collection).
3. **Decision 10 — proposal-apply rollback.** No integration test drives a proposal apply that
   fails partway through panel creation and asserts `dashboard.create` was written but
   `dashboard.delete` was NOT written for the rolled-back dashboard. This is the single most
   security-trail-sensitive scenario in the whole ticket (a false "this was deleted" row for a
   resource that, from the caller's perspective, never existed) and has zero automated
   verification that the `deleteInternal` wiring stays correct under future refactors.

Task 7.5 (exhaustive route-file audit-action enumeration) is a lower-severity gap — it is a
documentation/completion-check task, not itself a missing test — but its absence means there is no
artifact proving every `post`/`put`/`patch`/`delete` route in
`backend/src/main/scala/com/helio/api/routes/` was walked and reconciled against an audit action
or an explicit scope exclusion, which is the mechanism design.md Decision 9's own preamble says
exists specifically to catch a missed call site "not discovered by a diff grep after the fact."
Given how much of this ticket's design effort (4 skeptic rounds) went into finding exactly such
gaps, shipping without this checklist is a real, not cosmetic, risk of an as-yet-undiscovered
missed mutation.

**Verdict on the coverage gap:** not acceptable to PASS as-is. The AC's parenthetical
("integration tests using the route testkit + a real/embedded audit repo") is not decorative — it
is the acceptance criterion's evidentiary mechanism, and 7.7–7.9 cover precisely the three
highest-design-effort, correctness-sensitive edge cases in the ticket. A future refactor of
`AuthService`/`MfaService`/`PanelService.batchCreate`/`DashboardProposalService` could silently
regress any of these three behaviors and nothing in the test suite would catch it.

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala` route-shape, `schemas/**`, or
`openspec/specs/**` changes that affect any UI surface (the `ApiRoutes.scala` change is purely an
additive constructor parameter with no route/response-shape change).

### Overall: FAIL

### Change Requests

1. Add the integration test in tasks.md 7.7: an MFA-enrolled user's login via the route testkit,
   asserting `auth.login.challenged` is written at the initial `POST /api/auth/login` call and
   that the subsequent `POST /api/auth/mfa/verify` (or equivalent verify route) writes `auth.login`
   (not a duplicate `auth.login.challenged`) on success, and `auth.login.failed` on an incorrect
   TOTP code.
2. Add the integration tests in tasks.md 7.8: `panel.batch_create` and `panel.batch_update` each
   write exactly one audit row per call (not one per panel) with the correct count in `metadata`;
   `dashboard.import` and `dashboard.contents.replace` each write exactly one row.
3. Add the integration test in tasks.md 7.9: a proposal apply that fails partway through panel
   creation writes `dashboard.create` for the dashboard but does NOT write `dashboard.delete` for
   the same dashboard id after the `deleteInternal` rollback.
4. Complete tasks.md 7.5 — walk every `post`/`put`/`patch`/`delete` directive under
   `backend/src/main/scala/com/helio/api/routes/` and record, per route, either the audit action it
   maps to or an explicit out-of-scope reason. This can live as a completion-notes artifact (or an
   addendum to `files-modified.md`) rather than a test, but it must exist before this ticket is
   considered done, per the task's own "this is the completion check for the whole change" framing.

### Non-blocking Suggestions

- None beyond the above — the implementation itself (as read) is correct against every
  design.md Decision; the gap is exclusively in evidentiary test coverage for three specific,
  high-risk call-site families.
