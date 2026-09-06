## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `6d83d21e` (cycle 1 reviewed `93551626`).

Re-review scope: the cycle-1 change request (CR1, spec-delta scenarios) plus the one non-blocking
suggestion the executor chose to take (the `deleteAfterPrecheck` indentation). Cycle-1's verified
findings on the migration, mutation gates, two-pool harness, and D9 pre-check are not re-derived
here except where the new diff could have disturbed them — which I checked, and it did not.

### Phase 1: Spec Review — PASS

**CR1 (blocking) — RESOLVED, and resolved with a test behind it rather than with different
confident wording.** I verified each amended clause against the delivered gate line by line:

- **Scenario "Deleting a sole root's DataSource with no user context raises"** now reads *"WHEN a
  connection on the privileged (`BYPASSRLS`) pool — a role that is `NOSUPERUSER` and `NOBYPASSRLS`
  but has escalated via `SET ROLE helio_privileged`, with `app.current_user_id` never set"*. That
  is precisely, mechanism-for-mechanism, what test `3.2`
  (`V100ZeroRootGuardNonSuperuserSpec:268`) does: `freshConn()` (spec:135-139) logs in as
  `helio_migration_test` — the role created `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS` at spec:78-82 — and `attemptDelete(dsId, privileged = true, guc = None)` calls
  `asPrivileged` (spec:141-145), whose sole action is `SET ROLE helio_privileged`, and never
  touches the GUC (`guc.foreach` at spec:189 is a no-op for `None`). The wording is not an
  approximation; it names the exact escalation path in the code.
- Both of that scenario's `THEN` clauses are covered, not just the first. The raise is asserted on
  message *and* SQLSTATE (`include("HEL-913")`, `include("zero roots")`, `Some("P0001")`), and the
  rollback clause — which a raise alone does not establish, as the test's own comment says — is
  asserted by three separate post-state counts (`pipelines`, `pipeline_roots`, `data_sources` all
  `shouldBe 1`), matching the scenario's "leaving the pipeline, its root, and the DataSource
  intact".
- **Scenario "A no-user-context delete of a whole pipeline still succeeds"** now names the same
  privileged-pool shape, and matches test `3.5` (spec:331): `freshConn()` + `asPrivileged`, GUC
  never set, `noException should be thrownBy` the `DELETE FROM pipelines`, plus post-state counts
  of `0`/`0`. Covered.
- **The added requirement sentence is factually accurate**, which matters because an inaccurate
  explanation here would be the original defect one step along. It claims the plain
  `NOSUPERUSER NOBYPASSRLS` app-pool shape raises `42704`/`22P02` on the outer DELETE because
  `data_sources_owner` has no `missing_ok=true`, and cites `probe.md` task 1.1. Both SQLSTATEs and
  the `missing_ok` cause are exactly what `probe.md`'s two recorded discarded-attempt transcripts
  show. The distinction it draws — "unreachable, not unprotected" — is the correct reading and is
  the one I independently reached in cycle 1.
- **The requirement's SHALL text is untouched**, as instructed. It still asserts enforcement does
  not depend on the GUC, on the caller holding `BYPASSRLS`, or on row visibility — which remains
  accurate and is the clause that carries the actual guarantee.
- The three scenarios I did not flag remain correct and covered: the user-context parity scenario
  by `3.3` (`privileged = false, guc = Some(owner)`), and the two false-positive scenarios by
  `3.4` and `3.5`.

**No scope creep in the fix cycle.** The cycle-2 diff is three files and nothing else: the spec
delta, the indentation-only change, and a `files-modified.md` update that accurately describes
both. No planning artifact was retro-edited to match, and `tasks.md` was not disturbed.

### Phase 2: Code Review — PASS

**Gates re-run by me on `6d83d21e` in `WORKTREE_PATH`:**

- `sbt test` (full suite): **256 suites, 3892 tests, 0 failed**, exit 0 — identical totals to
  cycle 1, so nothing was silently dropped or newly ignored. All 13 `V100ZeroRootGuardNonSuperuserSpec`
  tests observed green by name again, including both mutation states and the post-mutation sanity
  check.
- `npm run check:scala-quality`: **clean** (157 pre-existing informational soft warnings,
  unchanged from cycle 1).
- No frontend files changed, so the `frontend/**` gates do not apply.
- Working tree clean apart from my own untracked evaluation reports.

**Nothing regressed, verified rather than assumed:**

- **V99 is still byte-unchanged at HEAD.** `git diff main..HEAD -- .../V99*` is empty, and
  `git diff --name-status main...HEAD -- .../db/migration/` still returns exactly one line,
  `A V100__zero_root_guard_rls_independent.sql`. The cycle-2 commit did not touch any migration.
- **The `DataSourceService` change is indentation-only.** Reading the diff hunk directly: every
  moved line is character-identical apart from leading whitespace — same `match` arms in the same
  order, same `deleteFileF.flatMap(...).map(...).recover(...)` chain, same `isZeroRootViolation`
  guard, same `log.warn`, same `soleRootConflict(source, Vector.empty)`. No behaviour change
  smuggled in alongside the reformat, which is the specific hazard of a "just formatting" commit.
  The D9 ordering property is intact: the privileged count-only check still sits in `delete`'s
  `case _ =>` branch and `deleteAfterPrecheck` (which owns every `fileSystem.delete` call) is
  still reachable only when that count is zero. `3.7c`'s `fileSystem.exists(filePath) shouldBe
  true` re-proves this behaviourally and is green.
- The two non-blocking suggestions the executor did not take (the vacuous `resourceId` assertion
  at spec:518, and `3.7c`'s conflict-shape assertion) were non-blocking in cycle 1 and remain so.
  Declining them is a legitimate call; neither affects correctness.

### Phase 3: UI Review — N/A

Unchanged from cycle 1. The cycle-2 diff touches one backend Scala file and two `openspec/changes/**`
docs. No `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`.

### Overall: PASS

Cycle 1's blocking finding is genuinely closed — the amended scenarios describe a shape that is
both reachable and exercised by the named gates, and the explanatory sentence matches the recorded
probe evidence rather than restating a guess. The change ships a migration that is verified under a
real non-superuser role, proven vacuous before the fix and proven load-bearing by two-directional
mutation, with a tripwire that turns a future re-own regression from silent into loud, and a
privileged count-only pre-check whose divergence gates run against two genuinely distinct pools.

### Non-blocking Suggestions

- Carried over from cycle 1, still optional: `V100ZeroRootGuardNonSuperuserSpec.scala:518`'s
  `conflict.resourceId should not be pid` is vacuously true (`resourceId` is the data-source id by
  HEL-987's contract), and `3.7c` could assert the *anonymous* conflict variant rather than merely
  that some conflict was returned.
