## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- [x] All ticket acceptance criteria addressed explicitly, not partially:
  - AC1 (per-run persistence linked to run): `PipelineRunService.persistAssertions` called from all
    three terminal branches (`Failure` real run under `if (!isDry)`, `onDryRunSuccess`, `onRunSuccess`);
    `pipeline_run_assertions` FK's `run_id → pipeline_runs(id)`. Verified via
    `PipelineRunServiceSpec`/`PipelineRunRepositorySpec`.
  - AC2 (all six rule kinds evaluate correctly): `AssertStep.evaluateRules` implements
    `notNull`/`unique`/`range`/`rowCountMin`/`rowCountMax`/`regex`; `AssertStepSpec` covers every
    scenario named in the ticket plus edge cases (absent field, non-numeric, malformed rule, invalid
    pattern, invalid severity, unknown kind).
  - AC3 (readable per run, RLS-safe owner+grantee): `listAssertionsByRun` (owner-scoped,
    `withUserContext`) + `listAssertionsByRunInternal` (system-context) mirror
    `listByPipeline`/`listByPipelineInternal`'s split exactly.
  - AC4 (row-in/row-out contract): `AssertStep.evaluate` still returns `Future.successful(rows)`
    unchanged; results go only through `ctx.assertionSink.record(...)`. Confirmed by diff read and by
    `AssertStepSpec`'s existing "returns input rows unchanged" test (untouched) plus the new
    `spec.md` "Assert step output rows are identical to its input rows" scenario.
  - AC5 (migration + `sbt test` green + no FQNs): migration V84 added (re-checked against V83 highest,
    matching design.md Decision 7); `sbt test` re-run fresh by this evaluator, 2982/2982 green (see
    Phase 2); `check:scala-quality` (which mechanically enforces the no-inline-FQN rule) re-run fresh,
    clean.
- [x] No AC silently reinterpreted.
- [x] All 14 `tasks.md` items verified against the diff, item by item — each maps to a concrete,
  present code change (1.1/1.2 `AssertionResult.scala`+`PipelineStep.scala`; 2.1/2.2
  `AssertStep.evaluateRules`+wiring; 3.1 engine's optional 4th param; 4.1–4.3 migration+repository;
  5.1 service wiring with the `.recoverWith`/`if (!isDry)`/post-`insertDryRun` ordering all present
  exactly as specified; 6.1–6.5 the five new/extended test files).
- [x] No scope creep — diff is exactly the files listed in design.md's Impact section plus their
  test counterparts and the OpenSpec change docs; no unrelated changes.
- [x] No regressions to existing behavior: `previewStep`/`execute` call sites use the new
  `assertionSink` parameter's default (fresh, discarded sink) — confirmed unaffected by
  `InProcessPipelineEngineSpec`'s new "existing callers... unaffected" test, and the full `sbt test`
  suite (2982/2982, includes all pre-existing suites) is green.
- [x] No API contract/schema changes needed or made — this ticket is repository-method-only per its
  own non-goals; no `ApiRoutes.scala`, `schemas/`, or `openspec/specs/` changes, confirmed via
  `git diff --name-only`.
- [x] Planning artifacts (design.md's 7 numbered decisions + 4a) reflect the final implemented
  behavior — each decision was independently re-verified against the actual code and test-execution
  output (see the 5 flagged items below and Phase 2).

**Flagged correctness requirements — independently re-verified, not taken on the executor's word:**

1. **Row-in/row-out contract intact.** `AssertStep.evaluate` (`domain/steps/AssertStep.scala:97-102`):
   computes `results`, calls `ctx.assertionSink.record(results)`, then `Future.successful(rows)` —
   the exact `rows` reference passed in, never copied/mutated. PASS.
2. **`regex` null-guard mirrors `StringOpsStep.extractRegexFn`.** `evalRegex`
   (`AssertStep.scala:~200`): `val s = if (v == null) null else v.toString` before any `.toString`
   call, then `s == null || !compiled.matcher(s).find()` — a null/absent field short-circuits to a
   failed result, never reaches `.toString` on `null`. Confirmed by the `spec.md`-mirroring test
   `"regex rule fails gracefully on a null or absent field, without throwing"` and the malformed-field
   variant, both green under a fresh `sbt test` run. PASS.
3. **FAILED dry run never calls `insertAssertions`.** `executeRun`'s `Failure` branch
   (`PipelineRunService.scala:~303-320`): `persistAssertions(...)` is called via `.flatMap` **inside**
   the `if (!isDry) { ... } else Future.successful(())` block — not called unconditionally, not
   reachable when `isDry`. Confirmed structurally in the diff and behaviorally: the
   `"a failed dry run does not attempt to persist assertion results..."` test asserts
   `countAssertionRows() shouldBe before` after a failed dry run, and it passed on a fresh re-run.
   PASS.
4. **`onDryRunSuccess` sequences `insertAssertions` after `insertDryRun` completes.** The chain is
   `insertDryRun(...).flatMap(_ => deleteOldDryRuns(...)).recoverWith{...}.flatMap(_ =>
   persistAssertions(...))` — `persistAssertions` only runs once the preceding `flatMap` chain
   (starting with `insertDryRun`) has resolved, satisfying the FK-ordering requirement. PASS.
5. **Every `insertAssertions` call site `.recoverWith`-guarded; the FK-violation swallow is genuinely
   exercised.** All three call sites funnel through the single `persistAssertions` helper, which wraps
   `insertAssertions(...).recoverWith { case _ => Future.successful(()) }` — one guard, reused
   correctly (DRY), not three ad hoc copies. This evaluator re-ran
   `sbt "testOnly com.helio.services.PipelineRunServiceSpec"` in isolation and read the raw output
   directly (not the executor's report): the Postgres log for the
   `"an editor-grantee-triggered real run resolves normally..."` test shows
   `ERROR: insert or update on table "pipeline_run_assertions" violates foreign key constraint
   "pipeline_run_assertions_run_id_fkey" ... DETAIL: Key (run_id)=(...) is not present in table
   "pipeline_runs"` immediately followed by that test passing (`[info] - should an
   editor-grantee-triggered real run resolves normally despite no persisted run row`). This is
   independent, first-hand confirmation the `.recoverWith` guard is real and load-bearing, not just a
   claim. PASS.

**`check:openspec` pre-commit bypass claim — verified accurate.** Ran `npm run check:openspec` fresh in
the worktree; it fails with exactly the reason given: `change "assert-rule-evaluation" is complete
(14/14) but not archived`. The cited precedent (HEL-454, commit `f64e24d3`) exists on `main` with an
identical bypass rationale in its commit body. The characterization is accurate — archiving genuinely
happens in a downstream Delivery-phase step, not something the executor is positioned to do mid-cycle.

### Phase 2: Code Review — PASS

**Gates re-run fresh by this evaluator** (backend-only change; no `frontend/**` files touched, so only
the backend gate applies per role instructions):

- `cd backend && sbt test` → **2982/2982 passed**, 0 failed, 0 canceled (full suite, ~143s).
- `sbt "testOnly com.helio.services.PipelineRunServiceSpec"` in isolation → 6/6 passed, with the raw
  Postgres FK-violation log inspected directly (see item 5 above).
- `npm run check:scala-quality` → clean (0 hard violations; 108 pre-existing soft file-size warnings
  across the codebase, none newly introduced as a violation — `AssertStep.scala` at 275 lines is a
  soft-budget-only overage, informational per CONTRIBUTING.md, consistent with dozens of other files
  already over budget).
- `npm run check:openspec` → fails as expected/explained (see above; not a gate this ticket needs to
  pass mid-cycle).
- Manually grepped the diff for inline FQNs (`com\.helio\.[a-zA-Z]+\.`) — the only match was a
  legitimate `import com.helio.spark.PipelineRunCache` line, not an inline usage. No violations.

**CONTRIBUTING.md compliance:**
- Imports & Qualifiers: clean (mechanically confirmed above).
- ACL triad / "Adding a new ACL'd table" checklist: migration V84 has `ENABLE`+`FORCE ROW LEVEL
  SECURITY`, one owner policy (mirrors `pipeline_runs`' own single-policy-covers-ALL-commands V35
  pattern exactly — verified against `V35__rls_owner_only_tables.sql`), `pipeline_run_assertions`
  added to `RlsPolicyGuardSpec`'s `rlsTables` allowlist, index on `run_id`. `insertAssertions`/
  `listAssertionsByRunInternal` are privileged/system-context call sites with docstring comments
  explaining why the ACL bypass is safe, per CONTRIBUTING.md's `findByIdInternal` requirement.
- Value-class IDs used throughout (`PipelineRunId`, no raw `String` at repository/service boundaries
  for run identity).
- File-size soft budgets: `AssertStep.scala` (275 lines) and `AssertStepSpec.scala` (313 lines) are
  over the 250-line soft budget but under the 400-line "propose a split" threshold — informational
  only, not a gate failure, and consistent with the codebase's existing norm (many pre-existing files
  are similarly over budget).

**DESIGN.md**: N/A — no `frontend/**` files changed.

- [x] DRY: `persistAssertions` is a single shared helper for all three call sites rather than three
  copies of the `.recoverWith` guard; `evaluateRule`/`result`/`malformed`/`requireField` factor the
  six rule kinds' shared shape cleanly.
- [x] Readable: rule-kind dispatch is a straightforward `match`; magic values (`"warn"`/`"error"`,
  the six kind strings) are centralized in `SupportedKinds`/`SupportedSeverities` vectors, not
  scattered literals.
- [x] Modular: `AssertionResult`/`AssertionSink` isolated to their own file per design.md Decision 1's
  import-direction reasoning (verified: `domain.steps` imports from `domain`, never the reverse, and
  this placement doesn't introduce a new dependency edge).
- [x] Type safety: no `Any`/untyped escape hatches beyond the pre-existing `Map[String, Any]` row
  representation this codebase already uses everywhere; `Try(v.toString.toDouble).toOption` is a
  bounded, justified use for numeric coercion (mirrors `FilterStep`'s own precedent per design.md).
- [x] Security: RLS policy present and tested; no new user input reaches this code path beyond what
  HEL-454 already validated at `AssertConfig.decode`'s analyze-time allow-list.
- [x] Error handling: never-throws contract for malformed rules verified by dedicated tests
  (`noException should be thrownBy ...` for every malformed-input case: missing field, missing
  params key, invalid pattern, unknown kind, invalid severity); `.recoverWith` at the persistence
  boundary verified live (see Phase 1 item 5).
- [x] Tests meaningful: each of the six rule kinds has both a pass and a fail case; the persistence
  path has 5 distinct executeRun scenarios (success/failure/dry-success/dry-failure/grantee) that
  would each catch a real regression if the corresponding guard were removed — confirmed by manually
  reasoning through what each test would have observed had e.g. the `if (!isDry)` guard or the
  `.recoverWith` guard been omitted (an unhandled failed Future would have surfaced as a test
  failure, not a silent pass).
- [x] No dead code: no unused imports, no leftover TODO/FIXME in the diff.
- [x] No over-engineering: `AssertionSink`'s mutability is scoped tightly and explicitly justified in
  both design.md and the file's own doc comment as a deliberate, bounded departure — not a
  speculative abstraction.
- [x] Behavior-preserving where expected: `previewStep`/`execute`'s existing call sites are
  unaffected by the new optional parameter (default value); confirmed by dedicated regression tests
  and the full suite passing.

### Phase 3: UI Review — N/A

Confirmed rather than skipped: `git diff --name-only main...HEAD` matches none of the Phase 3
triggers — no `frontend/**` files, no `backend/src/main/scala/routes/ApiRoutes.scala` (in fact no
`ApiRoutes.scala` change at all), no `schemas/**`, no `openspec/specs/**` (the change's own delta file
lives under `openspec/changes/assert-rule-evaluation/specs/...`, which is the in-progress change
directory, not the merged `openspec/specs/` tree the trigger refers to). This is a backend-only,
repository-method-only ticket per its own explicit non-goals (no new HTTP route, no frontend surface).
No UI surface area was created or touched; dev servers were not started for this cycle.

### Overall: PASS

### Non-blocking Suggestions

- `AssertStep.scala` (275 lines) and `AssertStepSpec.scala` (313 lines) are over the 250-line soft
  budget. Not a gate failure and consistent with existing codebase norms, but if this file grows
  further in a future ticket (e.g. 419-C's fail-policy work), consider splitting rule-evaluation logic
  into its own file at that point.
