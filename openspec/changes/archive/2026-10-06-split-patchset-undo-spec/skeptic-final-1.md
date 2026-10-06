## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: ff65cc39e0c5b8ad4d2cd52057b248424be5e4c6 (a merge of origin/main b2a0d8088 into split commit 13db6d373).
Diff base: b2a0d80885ba15069e19f9982de199db309f2432. It was resolved live by `resolve-review-base.sh` after `git fetch` and equals `origin/main`.
Baseline: `git show origin/main:backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala`, the post-HEL-1337 spec named in design.md "## Rebaseline". It is 742 lines with 16 tests.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned READY on the branch `task/split-patchset-undo-spec/HEL-1293`.
- **Diff scope.** `git diff --stat $BASE...HEAD` touches only these files:
  - the old spec, which is deleted;
  - the trait and the four new specs;
  - comment-only edits in PatchSetUndoRoutesSpec:44, PatchSetUndoInverseSpec:19 and PatchSetApplyServiceSpec:186/290, which I read in full;
  - this change's openspec dir.

  No production code, CI config, `PatchSetApplyResolvers`, `playwright.config.ts` or `.gitignore` was touched. `grep -rn PatchSetUndoServiceSpec backend/src` returns only the declared carve-out, `Hel914Ac1EndToEndSpec.scala:63`.
- **Independent mechanical equivalence.** I wrote my own script, `scratchpad/hel1293-eq.py`. I did not reuse the executor's or the evaluator's scripts. The base is `git show origin/main:<old path>`, saved to `scratchpad/hel1293-old.scala`.
  - Test names (`"<subject> should <name>"`): old 16, new 16, and the sorted lists are identical.
  - Per-test text was compared **byte-for-byte**, with no whitespace stripping. Each comparison covers the comment lines directly above the test plus the brace-matched body. All 16 match, with 0 mismatches. This is stronger than an assertion-line multiset, because it shows that no assertion, statement or comment inside any test changed.
  - I also compared the whole `should` region, old lines 203-742 against every new spec's region from its first `should {` onward, as a non-blank line multiset. Only-in-old is **empty**, so nothing was dropped (this covers inter-test comments such as the section divider and the trailing HEL-904 note). Only-in-new holds just 2 extra `"PatchSetUndoService.undo" should {` subject openers and the matching closing braces. Both are structural lines that any split requires.
  - Fixture: I compared old lines 53-200 with the trait from its header to its closing brace, with blank lines dropped and `private`→`protected` normalized. The **only** difference is `class PatchSetUndoServiceSpec ...` → `trait PatchSetUndoServiceFixture ...`, with the identical mixin list. `beforeAll` order, `seedUsers()`, the `"patch-set-undo-service-spec"` temp-dir prefix, `super.afterAll()` and the HEL-1337-reworded `seedOutput` comment are all unchanged.
- **No copied setup (AC2, the HEL-1272 concern).** I read the preamble of every new spec, from the package line to its first `should {`. Each one has only imports, a doc comment and `class X extends PatchSetUndoServiceFixture {`. A grep for `beforeAll|afterAll|EmbeddedPostgres|Flyway` across the four `PatchSetUndo*Spec.scala` files has no hits. All fixture state lives in the trait.
- **Concern split (AC1).** The files are PanelDashboard (5 tests, 223 lines), Lane (5, 199 lines), Refusal (5, 137 lines) and RepoWiring (1, 45 lines). This matches design D1 as amended by the Rebaseline section. Every file is well under CONTRIBUTING's ~400-line limit.
- **Runtime (AC3).** I ran `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt "testOnly <4 new suites> PatchSetUndoInverseSpec PatchSetUndoRoutesSpec PatchSetApplyServiceSpec RouteTestBaseGuardSpec"`. It exited 0 with 8 suites completed, 76 tests succeeded and 0 failed. I ran `sbt --client shutdown` afterwards as a separate call. The log is `scratchpad/hel1293-skeptic-testonly.log`.
  - All 16 base test names appear as an exact `[info] - should <name>` line in that log (16/16), and there are 0 `*** FAILED` lines.
  - My first count read 0/16. That was my own grep missing ScalaTest's `should ` prefix, not a test problem. I fixed the pattern and re-ran the count.
  - Because each spec now boots its own database and all of them pass, there is no order dependency between tests (design D6).
- **Full suite.** I did not re-run `testFull`. Instead I read the evaluator's log, `scratchpad/hel1293-eval-testfull.log` (7.6 MB): "Suites: completed 431, aborted 0 / Tests: succeeded 6039, failed 0 / All tests passed." I relied on that pasted output, as the gate allows.
- **Refactor discipline.** No bugs surfaced, so no spinoffs were needed and no fix crept in.
- **UI review.** Not applicable: no `frontend/**` changes.

### Verdict: CONFIRM

### Non-blocking notes
- tasks.md still states the pre-rebaseline counts (19 tests, 4 RepoWiring tests). design.md "## Rebaseline" records the authoritative 16/1 figures.
- The rewritten D7 doc-comment lines in PatchSetUndoRoutesSpec:44 and PatchSetUndoInverseSpec:19 are about 150 or more characters long. Re-wrapping them would be purely cosmetic.
- `test-suite-weights.tsv:323` still lists `PatchSetUndoServiceSpec`. This is harmless, as design.md notes, and the next regeneration will drop it.
