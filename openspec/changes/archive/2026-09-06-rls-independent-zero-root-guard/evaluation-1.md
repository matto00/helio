## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `93551626` on `bug/rls-independent-zero-root-guard/HEL-974`.

### Phase 1: Spec Review — FAIL

**Verified clear:**

- **AC1 (raise + rollback with no user context)** — satisfied in substance by test `3.2`
  (`V100ZeroRootGuardNonSuperuserSpec:268`), which raises `P0001` and leaves the fixture intact.
  See CR1 for a wording divergence between the AC's literal role shape and what was proven.
- **AC2 (no false positives)** — tests `3.4` (one of two roots), `3.5` (whole pipeline), and the
  service-level `3.7f` all pass under the GUC-unset connection, exactly as design D6 requires.
- **AC3 (a gate that genuinely runs as the non-superuser role and actually fires the trigger)** —
  satisfied by the D4 equivalent. `V100ZeroRootGuardNonSuperuserSpec` provisions a real
  `helio_migration_test` role (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, owner of
  `public`, spec lines 66–119), migrates the full chain as that role, and demonstrably fires the
  trigger (13/13 tests observed green in my own run). The AC's own "or an equivalent" clause is
  explicitly invoked in design D4.
- **AC4 (mutation-proven, right-reason red)** — verified in detail, see Phase 2 item 2.
- **AC5 (V99 header + HEL-913 `tasks.md` caveat updated)** — the target moved to V100's header by
  the settled `v100-header-only` ruling; both surfaces carry the correction, and the archived
  `2026-09-04-multi-root-pipelines/tasks.md` caveat now records the gap as real, names the false
  reassurance in the old "`FlywayNonSuperuserMigrationSpec` re-confirmed green" claim, and points
  at the change dir. Intent satisfied.
- **Owner constraint "prove vacuity before fixing"** — `probe.md` task 1.1 records the pre-fix
  transcript (`raised=None sqlState=None pipelines=1 pipeline_roots=0`) plus task 1.2's
  GUC-set control isolating the cause to RLS session state. Two wrong-reason attempts are
  recorded and explicitly discarded rather than quietly dropped. This is the standard the
  ticket asked for.
- **Owner constraint "no already-applied migration edited"** — confirmed byte-level, see Phase 2
  item 1.
- **Scope** — no scope creep. The one out-of-obvious-scope change (`DataSourceService`/
  `DataSourceRepository`) is covered by the `widen-precheck-privileged-count` owner ruling and is
  correctly framed in the proposal as an interaction created by this fix, not a HEL-987
  regression fix.
- **Tasks** — all 26 checked, and each one I sampled corresponds to real delivered work. The
  scratch probe spec (`ProbeVacuityScratchSpec`) was genuinely deleted, as `files-modified.md`
  claims.
- **No regressions** — full `sbt test` green (see Phase 2).

**Issue: CR1** — the spec delta's scenario `WHEN` clauses describe a condition that is not what
was proven and, per this change's own `probe.md`, is not executable. Detail in Change Requests.

### Phase 2: Code Review — PASS

**Gates, re-run by me in `WORKTREE_PATH` (not taken from the executor's report):**

- `sbt test` (full suite): **256 suites, 3892 tests, 0 failed**, exit 0.
- Targeted re-run of `V100ZeroRootGuardNonSuperuserSpec` + `DataSourceRoutesSpec` +
  `FlywayNonSuperuserMigrationSpec`: 81 tests, 0 failed. All 13 new tests observed green
  individually by name, including both mutation states.
- `npm run check:scala-quality`: **clean** (157 pre-existing soft file-size warnings, informational
  only per `CONTRIBUTING.md:236`; none introduced by this diff's main-source files).
- No frontend files changed, so the `frontend/**` gates (`lint`, `format:check`, `test`, `build`)
  do not apply.
- Working tree clean; no stray artifacts.

**Item-by-item verification of the six named risks:**

1. **V99 byte-unchanged — CONFIRMED.** `git diff main..HEAD -- backend/src/main/resources/db/migration/V99*`
   is empty. `git diff --name-status main...HEAD -- backend/src/main/resources/db/migration/`
   returns exactly one line: `A V100__zero_root_guard_rls_independent.sql`. No already-applied
   migration was touched by any means. The Flyway-checksum boot hazard is not present.

2. **Mutation states are real tests that genuinely mutate ownership, and restore — CONFIRMED.**
   `mutateFunction` (spec:252) issues a real `CREATE OR REPLACE` plus
   `ALTER FUNCTION hel913_prevent_zero_root_pipelines() OWNER TO <role>` over the EmbeddedPostgres
   superuser connection — a genuine ownership mutation, in-memory, never touching the migration
   file on disk (design D8 honoured). State A (spec:358) reverts ownership *and* drops the
   tripwire and asserts the silent orphan (`msg`/`state` both `None`, `pipelines=1`,
   `pipeline_roots=0`) — the identical post-state as the pre-fix probe, which is what makes the
   re-own provably load-bearing. State B (spec:383) reverts ownership only and asserts the loud
   `42501` / `row-level security policy`. The two are mutually exclusive by construction, as
   design D5 predicted.
   **Restoration is sound:** both tests call `restoreV100State()` in a `finally`, so an assertion
   failure cannot leave the function poisoned, and a trailing "post-mutation sanity" test (spec:399)
   independently re-verifies both the behaviour (`P0001`/`HEL-913`) and `pg_proc.proowner =
   helio_privileged` before the D9 block runs. Later assertions cannot be poisoned.
   **The mutation bodies are not drifted copies:** I diffed `originalFunctionBody` (spec:198)
   against V99's real body and `fixedFunctionBody` (spec:221) against V100's — both match
   statement-for-statement, differing only in the dollar-quote tag (`$BODY$` vs `$$`, semantically
   irrelevant). This closes the "inline copy that proves nothing" failure mode.

3. **The D9 gates run against two genuinely distinct pools — CONFIRMED, and this is the item I
   scrutinised hardest since it is skeptic round 2's CR2 and the ticket's own failure class.**
   `appDb` connects as `helio_migration_test` (`NOSUPERUSER NOBYPASSRLS`); `privilegedDb` is a
   separate `JdbcBackend.Database` with `connectionInitSql = "SET ROLE helio_privileged"`
   (spec:104–117), and they are passed as two distinct databases into `new DbContext(appDb,
   privilegedDb)` (spec:119) — explicitly *not* `DataSourceRoutesSpec`'s `new DbContext(db, db)`
   shared-superuser shape, which the spec header calls out by name. Invisibility is produced by
   real RLS, not asserted.
   **Fixture-liveness assertions exist and run before the divergence assertions** in all three
   gates where the invisible branch is under test: `3.7c` (spec:494–497, `withClue` +
   `rlsScoped shouldBe empty`, then `service.delete` at 499), `3.7d` (512 before 514), `3.7f`
   (545–546 before 548). `3.7e` correctly has none — it is the *visible*-path regression gate and
   asserts the opposite. These gates are not vacuous.

4. **The privileged count-only check — CONFIRMED on all three constraints.** The predicate in
   `soleRootDependentPipelineCountPrivileged` (`DataSourceRepository.scala:265-276`) is
   character-for-character the same join/`IN`/`GROUP BY`/`HAVING count(*) = 1 AND
   bool_and(r.data_source_id = ...)` as `soleRootDependentPipelines` (`:229-236`), differing only
   in projecting `count(*)` from a subselect instead of `(id, name)`. It is *not* the rejected
   broader any-referencing predicate. It projects `.as[Int].head` — a count and nothing else, no
   id, no name, so the invisible branch cannot leak a cross-tenant identifier. It runs on
   `ctx.withSystemContext`, which `DbContext.scala:63-64` confirms is the privileged
   (`helio_privileged`, BYPASSRLS) pool. And it is called **before** `deleteFileF`:
   `DataSourceService.scala:591` sits inside the `case _ =>` of the RLS-scoped check, and every
   file deletion is inside `deleteAfterPrecheck`, which is only reachable from the `count == 0`
   branch. `3.7c` proves this behaviourally by asserting `fileSystem.exists(filePath) shouldBe
   true` after the refusal. The short-circuit (privileged check skipped when the RLS-scoped check
   already found a blocker) is implemented as designed, and `3.7e` proves HEL-987's named 409 is
   unchanged on the visible path.

5. **V100's header states why V99 was not corrected in place — CONFIRMED.** The final header
   block spells out that Flyway checksums the whole file including comments, that
   `Database.initApp` runs with validation on, that a single byte fails boot on every database
   that has applied V99, that this is the incident class the v0.7.x release already hit, and
   directly instructs a future reader not to "tidy up" V99's now-stale HONEST LIMIT section. This
   is exactly the owner requirement, and it is unusually well done.

6. **Gates re-run — see above.** All green from my own fresh run.

**On the probe's refinement of the repro shape (asked explicitly):** the refinement is correct
and does *not* quietly change what was proven. `probe.md` task 1.1 records that the ticket's
literal shape (app-pool connection, `NOSUPERUSER NOBYPASSRLS`, GUC unset) cannot reach the trigger
at all: `data_sources_owner` (V35) has no `missing_ok=true`, so the *outer* `DELETE FROM
data_sources` hard-errors first — `42704 unrecognized configuration parameter` with the GUC never
set, or `22P02 invalid input syntax for type uuid: ""` with it blanked. Both are correctly
classified as wrong-reason reds and discarded rather than accepted. The defect surface that
matters is unchanged either way: the trigger is `SECURITY DEFINER` and its *internal* read
executes as the non-BYPASSRLS table-owning role regardless of the caller, so the privileged-pool
delete is the only connection shape that reaches the trigger with the GUC unset — and it is
precisely the writer class the ticket's own Scope names ("a migration, an admin script, a future
privileged path, or a background job"). The literal app-pool shape is not a hole left unclosed;
it is unreachable, failing loudly and rolling back. So AC1's *intent* (the `pipelines=1, roots=0`
orphan must not be reachable) is fully satisfied, and the substituted shape is strictly the
harder case. My only complaint is that this correction landed in `probe.md` but not in the spec
delta — CR1.

**Other code-quality checks:** DRY (predicate deliberately duplicated once with a pinned-and-
explained rationale rather than abstracted — the right call, since divergence is the hazard);
readable; type-safe (no `Any`, no casts); no dead code; no TODO/FIXME; no over-engineering; error
handling and the `P0001` signature match are unchanged; the `deleteAfterPrecheck` extraction is
behaviour-preserving (the moved body is byte-identical apart from indentation). Security: the
count-only projection and the `Vector.empty` conflict are the correct non-disclosure shape, and
`3.7d` gates it.

### Phase 3: UI Review — N/A

No UI-affecting files changed. The diff touches only `backend/src/main/resources/db/migration/`,
two backend Scala sources, one backend test, and `openspec/changes/**`. No `frontend/**`, no
`ApiRoutes.scala`, no `schemas/**`, and no `openspec/specs/**` (the spec delta lives under
`openspec/changes/`, which is not a trigger).

### Overall: FAIL

One change request, narrow and cheap. The implementation itself is correct and unusually
well-evidenced; the defect is in the durable spec artifact.

### Change Requests

1. **`openspec/changes/rls-independent-zero-root-guard/specs/pipeline-zero-root-db-guard/spec.md`
   — two scenario `WHEN` clauses assert a condition that was not tested and, per this change's own
   `probe.md`, cannot occur. Fix the wording to match what was actually proven.**

   - Scenario "Deleting a sole root's DataSource with no user context raises" currently reads
     *"WHEN a role that is `NOSUPERUSER` and `NOBYPASSRLS`, with `app.current_user_id` unset,
     deletes a DataSource that is bound by the only root of a still-existing pipeline / THEN the
     statement raises, naming the zero-root invariant"*. `probe.md` task 1.1 establishes that this
     exact connection shape never reaches the trigger — the outer `DELETE` fails first with
     `42704` on `data_sources_owner`. So the statement does raise, but it does **not** name the
     zero-root invariant, and the delivered gate for this requirement (`3.2`) uses a
     privileged-pool connection instead. The scenario as written is therefore false in its `THEN`
     and is covered by no test.
   - The same applies to "A no-user-context delete of a whole pipeline still succeeds", whose
     `WHEN` names a `NOSUPERUSER NOBYPASSRLS` role while its gate (`3.5`) runs on the privileged
     connection.

   **Required change:** amend both `WHEN` clauses to name the connection shape actually exercised
   (a connection on the privileged/`BYPASSRLS` pool with `app.current_user_id` never set, against
   a `SECURITY DEFINER` trigger whose own read executes as the non-`BYPASSRLS` table owner), and
   add one sentence to the requirement recording *why* — that the plain app-pool/GUC-unset shape
   errors on `data_sources_owner` before the trigger is reached, so it is unreachable rather than
   unprotected. The requirement's own SHALL text ("Enforcement SHALL NOT depend on
   `app.current_user_id` being set, on the deleting role holding `BYPASSRLS`, or on the affected
   rows being visible") is accurate and should stay as-is.

   **Why this is blocking rather than a nit:** this change exists because a migration header
   archived a confident claim about RLS reach that no test backed. Shipping a spec delta whose
   scenarios describe an untested and non-executable condition reproduces that failure class in
   the very artifact meant to close it — a future reader who runs the scenario literally will hit
   `42704` and conclude the guard is broken. `probe.md` already contains the correct analysis; it
   just needs to reach the spec.

### Non-blocking Suggestions

- `DataSourceService.scala:604-627` — `deleteAfterPrecheck`'s body was moved without re-indenting,
  so the whole method sits at the extracted call site's original 12-space depth inside a method
  declared at 2. No gate catches it (there is no scalafmt gate in this repo) and behaviour is
  unaffected, but it reads as an unfinished extraction. Worth re-indenting to the normal 4-space
  body depth while the file is open.
- `V100ZeroRootGuardNonSuperuserSpec.scala:518` — `conflict.resourceId should not be pid` is
  vacuously true: `resourceId` is the *data source* id by HEL-987's own contract (asserted at
  spec:537), so it could never equal the pipeline id. The load-bearing non-disclosure assertions
  on `reason` and `err.message` are the real gate; this line adds no coverage and could mislead a
  future reader into thinking `resourceId` is a disclosure vector under test.
- `3.7c` (spec:499-501) asserts only that *a* conflict came back. Since the fixture-liveness
  assertion pins the RLS-scoped branch to empty, the conflict provably originates from the
  privileged check — but asserting the conflict is the anonymous (`Vector.empty`) variant, as
  `3.7d` does, would make that reasoning local to the test rather than inferred.
