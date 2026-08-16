## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established independently** (not from the evaluator's report, read only after forming
my own view):

- `git log --oneline -5` inside the worktree: single commit `0ebfcd33 HEL-509 Add assertion rule
  evaluation + per-run results persistence`, on top of `main` at `3e4adac0`. `git diff main...HEAD
  --name-only` matches `files-modified.md` exactly — no extra/missing files, no scope creep (no
  `frontend/**`, no `schemas/**`, no `ApiRoutes.scala`, no `openspec/specs/**` outside this change's own
  delta — consistent with the ticket's stated non-goals).

**Acceptance criteria traced to code:**

- AC1 (persist per rule, linked to run): `PipelineRunRepository.insertAssertions`
  (`backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala:248-265`), called from
  `PipelineRunService.persistAssertions` (`PipelineRunService.scala:346-349`), itself called from all
  three terminal paths: the `Failure` branch (line 316, nested inside `if (!isDry)`), `onDryRunSuccess`
  (line 371), `onRunSuccess` (line 426). Migration `V84__pipeline_run_assertions.sql` FKs `run_id →
  pipeline_runs(id) ON DELETE CASCADE`. Verified end-to-end via a fresh `sbt
  "testOnly com.helio.services.PipelineRunServiceSpec"` run (below).
- AC2 (all six rule kinds): `AssertStep.evaluateRules`/`evalNotNull`/`evalUnique`/`evalRange`/
  `evalRowCount`/`evalRegex` (`AssertStep.scala:130-254`). `AssertStepSpec` exercises pass and fail cases
  for every kind plus edge cases (absent field, non-numeric, malformed params, invalid pattern, invalid
  severity, unknown kind) — read the diff directly, then ran the suite fresh (below), 232/232 green
  across the four directly-relevant spec files.
- AC3 (readable per run, RLS-safe owner+grantee): `listAssertionsByRun` (owner-scoped JOIN through
  `pipeline_runs`→`pipelines.owner_id`) and `listAssertionsByRunInternal` (system-context)
  (`PipelineRunRepository.scala:270-285`); migration's RLS policy mirrors `pipeline_runs`' own indirect-
  owner pattern one level deeper. `PipelineRunRepositorySpec`'s new tests cover owner-read, non-owner-
  empty-read (CS2 parity), and system-context-bypass — read directly, then re-run (green).
- AC4 (row-in/row-out contract): `AssertStep.evaluate` (`AssertStep.scala:97-103`) computes results,
  calls `ctx.assertionSink.record(results)`, then returns `Future.successful(rows)` — the same `rows`
  reference, untouched.
- AC5 (migration + `sbt test` + no FQNs): V84 confirmed next-available (main's highest is V83; no
  collision). `sbt test` re-run fresh by me: **2982/2982 passed**, 191 suites, 0 failed. Grepped every
  changed production file for inline FQNs (`com\.helio\.[a-zA-Z]`) — every match is a legitimate
  `package`/`import` line or a Scaladoc `[[cross.ref]]`, never an inline fully-qualified call site.
  `npm run check:scala-quality` re-run fresh: clean (0 hard violations; the pre-existing 108 soft
  file-size warnings are unaffected — `AssertStep.scala` at 275 lines is an informational soft-budget
  note only).

**The four hard-won correctness properties named in the brief — independently re-verified against the
actual diff, not taken on design.md's or the evaluator's word:**

1. **Regex null-guard mirroring `StringOpsStep` precedent.** `evalRegex`
   (`AssertStep.scala:241-243`): `val s = if (v == null) null else v.toString` computed *before* any
   `.toString`/matcher call, then `s == null || !compiled.matcher(s).find()`. A null or absent field can
   never reach an unguarded `.toString`. Confirmed both by direct code read and by the passing test
   `"regex rule fails gracefully on a null or absent field, without throwing"`.
2. **A failed dry run never calls `insertAssertions`.** `executeRun`'s `Failure` branch
   (`PipelineRunService.scala:302-319`): the entire `updateRun...persistAssertions(...)` chain sits
   *inside* `if (!isDry) { ... } else Future.successful(())` — structurally unreachable when `isDry`.
   Confirmed behaviorally: `PipelineRunServiceSpec`'s `"a failed dry run does not attempt to persist
   assertion results..."` test asserts `countAssertionRows() shouldBe before` after a failed dry run,
   and passed on my fresh re-run.
3. **`onDryRunSuccess` sequences `insertAssertions` after `insertDryRun` completes.**
   (`PipelineRunService.scala:361-371`): `insertDryRun(...).flatMap(_ =>
   deleteOldDryRuns(...)).recoverWith{...}.flatMap(_ => persistAssertions(...))` — `persistAssertions`
   only runs once the row that `insertAssertions`'s FK needs has actually been written. Confirmed by the
   passing `"persists assertion results on a successful dry run"` test, which would fail on an FK
   violation if the ordering were wrong.
4. **Every `insertAssertions` call site is `.recoverWith`-guarded, and the guard is genuinely
   exercised, not just present.** All three call sites route through the single `persistAssertions`
   helper (`PipelineRunService.scala:346-349`), which wraps the insert in `.recoverWith { case _ =>
   Future.successful(()) }`. I re-ran `sbt "testOnly com.helio.services.PipelineRunServiceSpec"` myself
   and grepped the raw output for the FK error — it is genuinely there:
   ```
   ERROR:  insert or update on table "pipeline_run_assertions" violates foreign key constraint
   "pipeline_run_assertions_run_id_fkey"
   DETAIL:  Key (run_id)=(7efc226d-a218-4ede-b246-d96bb32f9534) is not present in table "pipeline_runs".
   ```
   immediately followed by `[info] - should an editor-grantee-triggered real run resolves normally
   despite no persisted run row` passing. This is first-hand confirmation the FK violation actually
   occurs (an editor grantee's `insertRun` genuinely no-ops, leaving no parent row) and is genuinely
   swallowed — not a guard that happens to never fire.

**Gates re-run fresh by me (backend-only change, no `frontend/**` touched — no UI gate applies, and no
UI-facing view exists to screenshot: this ticket adds no route/protocol/frontend surface, confirmed by
`git diff --name-only`):**

- `sbt "testOnly com.helio.services.PipelineRunServiceSpec com.helio.domain.steps.AssertStepSpec
  com.helio.infrastructure.PipelineRunRepositorySpec com.helio.domain.InProcessPipelineEngineSpec"` →
  232/232 passed, 4 suites, 0 failed.
- `sbt test` (full suite) → **2982/2982 passed**, 191 suites, 0 failed, 0 canceled, Flyway migrated
  cleanly through V84 in the embedded-Postgres fixture.
- `npm run check:scala-quality` → clean, 0 hard violations.
- Grep for inline FQNs across every changed production file → none found.

**Other checks:**

- `PipelineExecutionContext(...)` construction sites: only `InProcessPipelineEngine.makeContext` (prod)
  and two test call sites in `AssertStepSpec` — no other direct constructor call was missed that would
  need the new `assertionSink` field threaded.
- `RlsPolicyGuardSpec.scala`'s 5-line diff adds `pipeline_run_assertions` to the RLS-table allowlist —
  this is the expected, required update (not scope creep) for a project-wide test that enumerates every
  RLS-enabled table.
- `files-modified.md` cross-checked line-by-line against `git diff main...HEAD --name-only` — exact
  match, no undisclosed files.
- Migration number: V84, confirmed as the correct next-available slot against `main`'s tracked migration
  files (highest is V83); the ticket/design.md's "main at V59" note was correctly identified as stale
  by the executor (per design.md Decision 7's own warning) and re-checked at execution time.

### Verdict: CONFIRM

All five acceptance criteria trace to real, tested code. All four correctness properties singled out by
the orchestrator as easy-to-regress landed correctly and are exercised by tests that would actually fail
if the guard/ordering were wrong (not tests that merely assert intent) — verified with my own fresh test
runs, including direct inspection of the raw Postgres FK-violation log for the `.recoverWith` guard.
Full `sbt test` is green (2982/2982), `check:scala-quality` is clean, no inline FQNs, no scope creep, no
API/schema surface added (matching the ticket's explicit non-goals). No UI changes to review.

### Non-blocking notes

- `AssertStep.scala` is 275 lines against a 250-line soft budget — already flagged as informational by
  `check:scala-quality`, not a blocker; a natural future split point if the file grows further (e.g. a
  7th rule kind).
- `AssertionSink`'s mutability is a deliberate, well-scoped exception to this codebase's otherwise-
  immutable style (design.md Decision 4) — narrowly confined to one new file and one optional engine
  parameter; nothing to change here, just noting it's the one place a future reviewer should look twice
  at if this pattern is ever reused elsewhere.
