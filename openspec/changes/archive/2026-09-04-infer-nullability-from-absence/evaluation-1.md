# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: a5a4745c. Gates re-run by the evaluator, not trusted from the executor's report.

## Phase 1: Spec Review — PASS

Issues: none blocking.

- AC1 (produced value, 1-of-100 + real fixture): PASS. `SchemaInferenceEngineSpec` "mark a field nullable when it is
  present in only 1 of 100 sampled rows" asserts the produced `nullable` on `stats.rec`, and the real-fixture test
  asserts `stats.rec` nullable AND `player_id` non-nullable. I independently verified fixture adequacy:
  `hel858/sleeper-mixed-projections-slice.json` has 15 elements, `stats.rec` present in 4, `player_id` present and
  non-null in all 15. So both arms are load-bearing on real data, and the false-positive guard is real (not a path
  that trivially cannot be nullable).
- AC2 (no false positives): PASS — `x` non-nullable in the ABSENT test, `player_id` on the fixture, the
  single-root-object test, and the 63-field WR pin.
- AC3 (three encodings, named): PASS. ABSENT and PRESENT-BUT-EMPTY have dedicated tests naming the encoding in the
  test name; the combined test labels all three inline (`// ABSENT`, `// EXPLICIT NULL`, `// PRESENT-BUT-EMPTY`).
  See non-blocking suggestion 1 on the explicit-null arm.
- AC4 (composed rule normative in spec): PASS — `specs/schema-inference/spec.md` adds `Requirement: JSON nullability
  from absence or null` with the iff rule stated as a block quote, the two-ways-to-fail clause, and present-but-empty
  called out as a third distinct encoding. The contradictory old scenario (`Absence of a key does not by itself mark a
  field nullable`) is explicitly REMOVED with a stated reason rather than left to coexist.
- AC5 (blast radius): PASS — assessed and reported in design D6 + files-modified.md + the spec Migration note:
  `SchemaInferenceFacade.toSchemaFields` drops `nullable`, so nothing persisted changes; the flag is preview-only
  (`/api/*/infer`) plus `WorkspaceContextColumn.nullable`, both recomputed per call. Stated, not assumed invisible.
- AC6 (order-independence): PASS — a test pins the full `(name, type, nullable)` triple sequence forward vs reversed
  over a heterogeneous array including a `JsNull` arm. The mechanism (count vs constant total) is order-independent
  by construction.
- AC7 (does absence corrupt type?): PASS — investigated, finding stated (it does not), and pinned by TWO arms
  (Integer and String), not asserted.
- Scope: no scope creep. `git diff --name-only main...HEAD` is exactly `SchemaInferenceEngine.scala`,
  `SchemaInferenceEngineSpec.scala`, and this change's own `openspec/changes/` artifacts.
- Run constraints: PASS. No file under `WorkspaceContextService.scala`, `PipelineService.scala`,
  `api/protocols/patchsets/`, the pipeline-proposal surface, or `helio-mcp` appears in the diff (the `npm ci` in
  `helio-mcp/` left no tracked change; working tree is clean). No Flyway migration, no DB access. HEL-893 not touched.
- Tasks: all items marked done match what is implemented. Task 3.12 ("update the WR pinned expectation for any field
  whose nullability now flips") produced NO diff to the pinned block — verified correct, see Phase 2.

## Phase 2: Code Review — PASS

Gates re-run by me (backend-only change, so the Scala gate applies):

- `cd backend && sbt -batch test` → `Tests: succeeded 3746, failed 0`, 246 suites, all passed. Fresh run in
  `WORKTREE_PATH`. (`CLEAN_WORKTREE` not set for this cycle, so gates ran in the delivery worktree as normal.)
- `node scripts/check-scala-quality.mjs` → clean (149 pre-existing soft file-size warnings, none on changed files).
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`.

**RED-before evidence: verified genuine.** I did not take `evidence/red-before.md` on trust. I restored only the
production file from `main` (`git checkout main -- SchemaInferenceEngine.scala`), left the new tests in place, and ran
`sbt "testOnly com.helio.domain.engine.SchemaInferenceEngineSpec"`. Result: `succeeded 53, failed 6`, and the six
failures are byte-for-byte the six recorded in `evidence/red-before.md`, including
`SchemaInferenceEngineSpec.scala:364` (the real-fixture `stats.rec` assertion) and `:118` (the 1-in-100 assertion).
The two new tests the skeptic specifically flagged as "not automatically red" (3.6, 3.7) are both in the red set. I
then restored the file and confirmed a clean working tree.

**WR-fixture pinned expectations: changed honestly — in fact, not changed at all.** The `main...HEAD` diff contains
zero hunks inside the 63-field `expected` block, and zero hunks in its attribution comment. The pin therefore held
unmodified across the fix, which is the strongest possible answer to "was it edited to make tests pass?" — it was not
edited at all. Corroborated by my revert run: that test was among the 53 that stayed GREEN pre-fix. The `true` entries
in the pin (`date`, `opponent`, `player.injury_*`) are explicit-`JsNull` fields attributed to HEL-858's rule in the
existing comment, and the new count rule reproduces them by the same arithmetic, so no re-attribution was owed.

Code quality:

- The fix is minimal and structurally right: `PathAcc.nullable: Boolean` → `presentNonNullCount: Int`, with
  nullability derived once at projection (`presentNonNullCount < objects.size`). This is genuinely ONE composed rule,
  not two co-existing rules — there is no `nullable = true` assignment anywhere in the fold, which is exactly what
  AC4 asked for at the code level.
- Order-independence is structural (integer addition vs a constant total), not test-attested.
- Superseded HEL-858 comments were rewritten rather than left standing (see suggestion 2 for the one exception).
- CSV: no code change, a clarifying comment, and a regression test pinning the ragged-row behaviour. The divergence
  (CSV conflates empty with absent) is stated normatively in the spec rather than silently tolerated. Correct call —
  CSV has no wire encoding for the distinction.
- No dead code, no unused imports, no TODO/FIXME, no `any`-equivalent escape hatch, no over-abstraction. `PathAcc`
  stays a two-field private case class.
- Behaviour-preserving where expected: `inferShallowFromJsObjects` (the pipeline-output path) is untouched and still
  pins `nullable = false`; that path's caller owns its own policy, so leaving it alone is correct and in scope.

## Phase 3: UI Review — N/A

No UI-affecting file changed. The diff touches only `backend/src/main/scala/com/helio/domain/engine/` and its spec,
plus `openspec/changes/` artifacts for this change — none of the Phase-3 triggers (`frontend/**`,
`ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`) match. Per the coordinator's binding run constraints, no browser
was driven and no dev server was started; this is correct here rather than a skipped step, since the change has no
rendered surface.

## Overall: PASS

## Change Requests

None.

## Non-blocking Suggestions

1. `backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala:~76` — the EXPLICIT-NULL encoding
   is covered by the pre-existing `ts`-nullable test and named inline in the three-encodings test, but it is the only
   one of the three without a dedicated test whose NAME carries the encoding label (ABSENT and PRESENT-BUT-EMPTY both
   do). Renaming that existing test to `... (EXPLICIT NULL encoding)` would make the symmetry self-evident.
2. `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala:146` — a stale claim survives in
   `inferShallowFromJsObjects`'s comment: "unrelated to this engine's absence-never-contributes rule". That rule no
   longer exists after this change. The substantive claim around it (this function does not compute nullability) is
   still true, so nothing is misleading about the function itself, but the trailing reference now names a deleted
   rule. Suggest: "...unrelated to `inferFromObjects`'s absence-or-null nullability rule (HEL-868)."
