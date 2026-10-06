## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: ff65cc39e0c5b8ad4d2cd52057b248424be5e4c6 (merge of origin/main b2a0d8088 HEL-1337 into split commit 13db6d373).
Diff base (live, resolve-review-base.sh): b2a0d80885ba15069e19f9982de199db309f2432 (= origin/main after `git fetch`).
Behaviour baseline (per design.md "## Rebaseline"): `git show origin/main:backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala`
(742 lines, 16 `in {` blocks, subjects at lines 203 and 710).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (split by concern): four concern specs (PanelDashboard 5, Lane 5, Refusal 5, RepoWiring 1) plus the trait. Largest new file is 223 lines.
- AC2 (share fixtures through a trait, no copied setup): `PatchSetUndoServiceFixture` is a `trait` holding all fixture state, `beforeAll`/`afterAll` and seed helpers. Every spec is `class X extends PatchSetUndoServiceFixture` and declares no fixture state of its own. The whole-file line-multiset check below shows that no fixture line appears more than once across the five new files. This is not the copied-setup split rejected in HEL-1272.
- AC3 (same test count, no assertion changes): 16 = 16, both statically and at runtime (see Phase 2).
- Driver constraints: `git diff --name-only $BASE...HEAD` has no hits for PatchSetApplyResolvers, ci.yml, playwright.config.ts, .gitignore or scripts/concertino/.
- tasks.md: all items checked. The cycle-1 task text still says "19"/"both HEL-1256 blocks", but design.md "## Rebaseline" and split-equivalence.md "Post-merge" record the 16-test rebaseline (see the non-blocking note).
- CONSTRAINTS: `[]`, so nothing to honour.

### Phase 2: Code Review — PASS
Issues: none.

**Gates, run by me in WORKTREE_PATH** (backend-only change, so the frontend gates do not apply):
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt "testOnly <4 new suites>"` exited 0: Suites completed 4, Tests succeeded 16, failed 0.
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` exited 0: Suites completed 431, aborted 0; Tests succeeded 6039, failed 0. RouteTestBaseGuardSpec ran and passed, and all four new suites appear in the log.
- `sbt --client shutdown` was run as a separate call.
- `npm run check:scala-quality` (clean), `check:test-temp-dir-hygiene` (clean), `check:openspec` (clean), `check:repo-integrity` (exit 0) and `check:no-credential-leak` (0 violations) all passed.
- Logs: scratchpad `hel1293-eval-testonly.log` and `hel1293-eval-testfull.log`.

**Independent mechanical equivalence checks.** I wrote my own script (scratchpad `hel1293-eval-check.py`, output `hel1293-eval-check.out`) instead of re-running the executor's. It uses a different parser: brace-depth matching with string-literal awareness, rather than the executor's `"    }"` line sentinel. Its comparisons are raw, not whitespace-stripped. The base is origin/main's old spec.
- Test names, as `"<subject> should <name>"`: base 16, new 16, sorted lists identical, no duplicates on either side.
- Per-test raw text (leading `//`/`/*`/`*` comment block plus the full brace-matched body, compared byte-for-byte with no strip): 0 mismatches across 16 tests.
- Relative order: each file holds a contiguous, monotonic slice of the base order (PanelDashboard [0..4], Lane [5..9], Refusal [10..14], RepoWiring [15]). This matches D1.
- Assertion multiset, scoped to test bodies with a broader regex than D5.2 (adds `should`, `must`, `===`, `intercept`, `matchPattern`, `inside(`, `succeed`, `cancel(`, `pending`): base 114, new 114, diff EMPTY. The executor's count is 108 under its narrower D5.2 regex. The counts differ only because the regexes differ; both diffs are empty.
- Comment multiset over the `should` regions: base 76, new 76, diff EMPTY. This matches the executor's figure.
- Whole-file non-blank line multiset, excluding package/import lines, with `private`→`protected` normalized:
  - Only-in-base: exactly 1 line, the `class PatchSetUndoServiceSpec ... {` header.
  - Only-in-new: the trait header, the 4 new class headers, the 4 new per-spec doc comments, 2 extra `"PatchSetUndoService.undo" should {` subject openers and 6 extra `}` closers.
  - These are all structural lines that a split requires. No logic line was added or dropped.
- Fixture raw diff, blank lines kept: base lines 49-202 (doc comment through the end of `applySuccessfully`) against the trait lines 43-194.
  - The class header changed to the trait header (the pre-declared delta).
  - `private`→`protected` on every member (allowed by D2).
  - 2 trailing blank lines were dropped.
  - Nothing else changed: `beforeAll` statement order, `seedUsers()`, the `"patch-set-undo-service-spec"` temp-dir prefix and the `super.afterAll()` call are all identical.

**HEL-1337 merge port**
- `git diff 13db6d373 ff65cc39e` on the fixture changes only the reworded `seedOutput` doc comment. It is byte-identical to origin/main's lines 152-154.
- RepoWiring dropped the null-outputRepo block (3 tests), `undoServiceWithoutOutputRepo` and `assertUnavailable`. A grep for those names finds no hits under services/patchsets.
- The parity test body is byte-identical to origin/main's.
- `git diff b2a0d8088 HEAD` touches only this change's files, so the merge brought in all of main and left no stray conflict residue.

**D7 pointers**
- `grep -rn PatchSetUndoServiceSpec backend/src` returns only `Hel914Ac1EndToEndSpec.scala:63`, the carve-out.
- PatchSetUndoRoutesSpec:44 and PatchSetUndoInverseSpec:19 now name the Panel/Lane/Refusal specs. Restore coverage is in Panel/Lane and conflict coverage (5.3e) is in Refusal, so the pointers are accurate.
- PatchSetApplyServiceSpec:186 now points to `PatchSetUndoServiceFixture`, which does declare `seedPipelineStep(..., parentStepId)`. Line 290 now points to `PatchSetUndoLaneSpec`, which holds the HEL-766 test.
- All four edits are comment-only.

**Other checks**
- Code quality: CONTRIBUTING imports are explicit, with no inline FQNs and no wildcard additions beyond the base's existing `com.helio.domain._` and similar. RepoWiring trims its imports to what it uses. The unused `ExecutionContext` import from the base was dropped in the trait.
- No dead code. No production code was touched.

### Phase 3: UI Review — N/A
No UI-trigger paths changed (backend test files and openspec/changes only).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- tasks.md items 1.1, 2.5, 3.2 and 2.5's "verify: testOnly passes 4" still state the pre-rebaseline 19/4 figures. Consider annotating them with the post-HEL-1337 16/1 figures so the archived artifact matches the final state (design.md "## Rebaseline" and split-equivalence.md already do).
- The rewritten D7 comment lines (PatchSetUndoRoutesSpec.scala:44, PatchSetUndoInverseSpec.scala:19) run to roughly 150+ characters, longer than the surrounding wrapped doc comments. Consider re-wrapping them for consistency (cosmetic only).
- The trait inherits the old class doc comment verbatim ("Service-level coverage for `PatchSetUndoService.undo` ...") as D2 specified. A future touch could reword it to describe the fixture.
