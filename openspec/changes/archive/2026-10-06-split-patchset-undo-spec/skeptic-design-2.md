## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD f78b4c5187a42ead6bf71eb6dce9070b020eda63 (branch task/split-patchset-undo-spec/HEL-1293). The change dir is untracked and there are no code changes yet.

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-patchset-undo-spec/HEL-1293`.
- Premise, re-measured: `wc -l` gives 805. `grep '" in {'` finds 19 tests in three `should` blocks (lines 203, 716, 749). Fixture lines 53-199 (code), blank lines 200-202, `undoServiceWithoutOutputRepo` at 710-714 and the local `assertUnavailable` at 751-754 all match design.md's line citations.
- D1 grouping traced against the line list again: 207/249/301/356/386, 408/436/478/516/546, 592/614/643/683/697 and 718/756/776/791. That is 5+5+5+4 = 19, with no omissions or duplicates.
- **Round-1 CR1 (check 2 failed by construction): resolved.** D5.2 is now scoped to test bodies, which excludes the subject lines and fixture lines, so the `"PatchSetUndoService.undo" should {` x3 problem is gone. Brace-matching also looks robust here. A per-line `{`/`}` count from line 203 onward shows only structural imbalance (`match {` / `}` and the `in {` / `}` pairs). There are no brace characters inside string or char literals in the test region. The only `${` is in fixture lines 138-139, and it is balanced on its line. A naive matching-brace scanner therefore gets the same body extents on both sides.
- **Round-1 CR2 (fixture not covered): mostly resolved.** D5.4 now diffs the fixture plus both helper defs, with `private`->`protected` normalization and pre-enumerated allowed deltas. It also names the right regressions as failures (reordered `beforeAll`, dropped `seedUsers()`, changed temp prefix). See CR2 below for one residual fails-by-construction gap.
- Round-1 non-blocking notes: tasks 1.1/3.2/3.3 now carry `HEL924_TEST_GROUP_CONCURRENCY=2`, the 600000 timeout and the separate `sbt --client shutdown`. D4 now says plainly "no re-indentation".
- D2 trait linearization: `system` comes from `HelioRouteTest`, which is initialized before the trait body, the same as in today's class body. `private` -> `protected` is required for subclass access. No objection.
- **New finding: live references to the deleted file.** I ran `grep -rn PatchSetUndoServiceSpec` across non-archive, non-change-dir paths. It shows 5 navigation pointers in 4 other test files that would dangle once `PatchSetUndoServiceSpec.scala` is deleted:
  - `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetUndoRoutesSpec.scala:44` ("Service-level restore/conflict coverage lives in `PatchSetUndoServiceSpec`")
  - `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoInverseSpec.scala:19` ("round trip ... is covered separately by `PatchSetUndoServiceSpec`")
  - `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala:186` ("mirrors PatchSetUndoServiceSpec's own fixture")
  - `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala:290` ("the HEL-766 test below in PatchSetUndoServiceSpec")
  - `backend/src/test/scala/com/helio/services/pipelines/Hel914Ac1EndToEndSpec.scala:63` (a historical probe note)
  - `backend/project/test-suite-weights.tsv` (an explicit non-goal, and harmless per the round-1 check)

  Nothing in proposal, design or tasks plans for these: no sweep task, no carve-out, no zero-hit grep check.

### Verdict: REFUTE

### Change Requests
1. **Plan the dangling-pointer sweep.** Add a task, after 2.6, that updates the comment pointers at `PatchSetUndoRoutesSpec.scala:44`, `PatchSetUndoInverseSpec.scala:19` and `PatchSetApplyServiceSpec.scala:186,290` to name the new concern spec that now holds the referenced coverage. Line 290 refers to the HEL-766 test, which goes to `PatchSetUndoLaneSpec`. Line 186 refers to the fixture's `seedPipelineStep` `parentStepId`, which goes to `PatchSetUndoServiceFixture`. These are comment-only edits, so no code or assertion changes. Decide explicitly whether `Hel914Ac1EndToEndSpec.scala:63` is updated or left as-is, since it is a historical record of a probe. Add a verify step: `grep -rn PatchSetUndoServiceSpec backend/src` returns zero hits, or only the explicitly carved-out line(s). Name these files in proposal.md Impact, because it currently says "under `backend/src/test/scala/com/helio/services/patchsets/`" only and `Hel914Ac1EndToEndSpec`/`PatchSetUndoRoutesSpec` live elsewhere.
2. **D5.4 still fails by construction on a literal reading, so pin its ranges.** D5 forbids "fixing by adjusting the check", so the ranges must be exact before execution. The base side is "lines 1-201 from the class header onward", which is 53-201 and ends in the blank line 201 (confirmed with `cat -A`, since lines 200-202 are blank). The trait side is "the trait body". If the executor takes that file through EOF, it includes the trait's closing `}`. That line is not among allowed deltas (i)-(iii), so a perfect split diffs non-empty. Fix this in one of two ways. (a) State that both sides drop blank lines and that the trait side runs from its header line through the line before its closing brace. (b) Add the trait's closing `}` as allowed delta (iv). Also state the base doc-comment handling: lines 48-52 sit before the class header, so they are excluded from the base side. Say whether the trait-side doc comment is likewise excluded or covered by delta (iii).

### Non-blocking notes
- D5.3 "each test block's full text": state whether the comment block above each test (which D4 says moves byte-for-byte) is part of the compared text. That makes D4's comment-move claim mechanically checked as well, rather than asserted.
- D6 isolation (a DB per spec, so cross-test row visibility is lost) is correctly framed as escalate-not-fix.
- The `undoServiceWithoutOutputRepo` / `assertUnavailable` placement in RepoWiringSpec is correct. Only the HEL-1256 blocks use them.
