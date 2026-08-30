## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Independently verified against the migrations and the actual commit (3dbcab81), not the executor's report.

- AC1 (`audit_events` + `connector_credentials` in `rlsTables` with accurate comments) — PASS.
  Comments match the migrations: V91 creates exactly `audit_events_owner` / `audit_events_update` /
  `audit_events_delete`; V92 creates the single `connector_credentials_owner`. The stale
  "pre-existing gap" note on the `connectors` entry was removed.
- AC2 (re-derive the full RLS table set) — PASS, re-derived independently:
  `grep -rhi "ALTER TABLE .* ENABLE ROW LEVEL SECURITY" backend/src/main/resources/db/migration`
  yields 27 distinct tables; the new `rlsTables` map has exactly 27 keys and matches 1:1. No further gaps.
- AC3 (`audit_events` assertion meaningful given the 3-policy split) — PASS. The exact-name-set
  assertion is the right call and the comment states the trigger-vs-RLS division honestly.
- AC4 (deliberately-broken probe proves non-vacuousness) — PARTIAL, see Change Request 1. The
  property holds today (I proved it myself, below), but the in-repo probe exercises a *copy* of the
  check logic rather than the assertion the spec actually ships.
- AC5 (mechanical same-PR enforcement recorded as a follow-up) — PARTIAL. `tasks.md` 3.1 is marked
  `[x]`, but no ticket was filed; the commit body honestly says "Deferred to the orchestrator to
  file — no Linear tool access from this session". A `[x]` on work that was handed off, not done, is
  a tasks-vs-reality mismatch (Change Request 2).
- Scope — PASS. Exactly one backend test file plus change-dir bookkeeping. No migration or
  production-code changes, matching design.md's Non-Goals.
- Planning artifacts reflect implementation — MOSTLY. design.md D3 and task 1.6 both promise the
  per-table check is "refactored into a small private method reused by BOTH the main loop and this
  probe". The shipped code does not do that (Change Request 1).

### Phase 2: Code Review — FAIL

Gates re-run fresh by me in the worktree (`CLEAN_WORKTREE` not set):

- `sbt "testOnly com.helio.infrastructure.persistence.RlsPolicyGuardSpec"` — 85/85 pass.
- `sbt test` — 3851 tests, 244 suites, 0 failures.
- `npm run check:scala-quality` — clean (146 pre-existing soft file-size warnings, none in this file).
- `npm run format:check` — clean. `npm run check:openspec` — clean. `npm run check:repo-integrity` — clean.
- No `frontend/**` files changed, so lint/typecheck/jest/build are not triggered by this diff.

Independent red/green evidence (my own runs, not the executor's claims). I mutated the migrations,
ran the spec, and restored the files (worktree left clean, verified with `git status`):

1. Appended `DROP POLICY audit_events_update ON audit_events;` to `V91__audit_events.sql` →
   the *shipped loop* assertion went red:
   `audit_events has exactly the expected policies ... *** FAILED *** ... Set("audit_events_delete",
   "audit_events_owner") was not equal to Set(...)` (RlsPolicyGuardSpec.scala:256). 83 pass / 2 fail.
   So the real guard is genuinely red-capable, and a bare `count > 0` would have stayed green here.
2. Appended `DROP POLICY connector_credentials_owner` + `NO FORCE ROW LEVEL SECURITY` to
   `V92__connector_credentials.sql` → exactly `connector_credentials`'s own `relforcerowsecurity`
   and `policy count` assertions failed (lines 234 / 247); every other table, `audit_events`
   included, stayed green. This is the allowlist-scoping property task 2.2 asked for, verified on
   `connector_credentials` (not `audit_events`) as the task specifies.

Findings:

- **DRY / guard-of-the-guard (blocking)** — `checkTable`
  (`RlsPolicyGuardSpec.scala:158-190`) re-implements the same three structural assertions that the
  per-table loop performs inline (`:207-260`). The loop never calls `checkTable`. The probe test at
  `:286-317` therefore proves that *`checkTable`* goes red, which is not the same statement as "the
  spec's shipped assertions go red" — the two can drift, and a future weakening of the loop's
  assertion would leave the probe green. This is the "inline copy" flavour of evidence-shaped
  non-evidence, and it is a direct deviation from design.md D3 / task 1.6.
- Readability / typing — good. Map shape, comments, and clue messages are clear; `Option[Set[String]]`
  is honest about the two check modes.
- Behavior preservation for the 25 `None` entries — confirmed: still `count > 0`, unchanged, and all
  their test names are byte-identical to before.
- Resource handling in the probe — correct: nested `try/finally` closes the Slick DB then the
  EmbeddedPostgres instance on every path.
- Non-blocking: `checkTable` uses early `return` (legal on Scala 2.13, but `return` inside a method
  that also has expression-style branches reads inconsistently). Line 294 is 106 chars (line 123 was
  already 103 pre-existing; no scalafmt gate is configured, so this is style-only).
- Non-blocking: task 2.2 asked to "record this as evidence"; no record of it exists in
  `files-modified.md` or the change dir. I performed the equivalent check myself (above), so the
  property is established — but the executor's own evidence trail for 2.2 is absent.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` files changed. Trigger
does not fire; dev servers not started.

### Overall: FAIL

### Change Requests

1. Make the per-table loop and the probe share one implementation, as design.md D3 and task 1.6
   specify. In `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala`,
   the loop bodies at `:207-260` must call `checkTable` rather than re-issuing their own SQL — e.g.
   keep the three granular test cases but have each one delegate to a shared private check
   (`checkRowSecurity` / `checkForceRowSecurity` / `checkPolicies`, or a single `checkTable` whose
   `Left` is asserted away with `withClue`), so the probe at `:286-317` exercises exactly the code
   path the guard ships. Deleting the duplicated SQL in `checkTable` in favour of the loop's version
   is equally acceptable — the requirement is one implementation, not two.
2. `openspec/changes/rls-guard-audit-connector-tables/tasks.md:18` — task 3.1 is marked `[x]` but no
   spinoff ticket exists; the commit body defers filing to the orchestrator. Either file the Linear
   ticket and record its id in `tasks.md`/`files-modified.md`, or change 3.1 to unchecked with an
   inline note that the ticket text is handed to the orchestrator in the commit body. Do not leave a
   `[x]` on work that was not performed.

### Non-blocking Suggestions

- Record the task 2.2 scoping check in `files-modified.md` (the mutation applied, the observed
  failures, and that the migration was restored) so the evidence survives beyond this review.
- Consider replacing `checkTable`'s early `return`s with a `for`-comprehension over `Either` for a
  single expression-style body.
- `:294` exceeds 100 columns; wrap for consistency with the rest of the file.
