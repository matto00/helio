## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD f78b4c5187a42ead6bf71eb6dce9070b020eda63 (branch task/split-patchset-undo-spec/HEL-1293; change dir untracked, no code changes yet).

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/split-patchset-undo-spec/HEL-1293`.
- Premise: `wc -l` on `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala` = 805. `grep '" in {'` lists exactly 19 tests in three `should` blocks (lines 203, 716, 749). No `ignore`/`when` blocks.
- Fixture boundaries in design.md hold: lines 1-201 are imports, `var` repos/services, `beforeAll`/`afterAll`, `await`, the seed helpers and `applySuccessfully`. `undoServiceWithoutOutputRepo` is at lines 710-714. `assertUnavailable` is a local def inside the null-outputRepo block (750-754). The HEL-904 4.5 trailing note is at 704-707.
- D1 grouping traced test by test against the line list. Panel/Dashboard is 207, 249, 301, 356, 386. Lane is 408, 436, 478, 516, 546. Refusal is 592, 614, 643, 683, 697. RepoWiring is 718, 756, 776, 791. That gives 5+5+5+4 = 19, with no test missing or counted twice. This covers the ticket's example concerns (panel undo, lane create/delete undo, repo-missing rejections).
- D2 trait approach: a precedent exists (`backend/src/test/scala/com/helio/api/routes/firstrun/FirstRunRoutesFixture.scala`). `RouteTestBaseGuardSpec` only rejects direct `ScalatestRouteTest`/`RouteTest` mixins, so a trait that mixes `HelioRouteTest` stays green. `TempDirectorySupport` is a `self: Suite =>` trait extending BeforeAndAfterAll, so the linearization is unchanged when it is mixed into a trait that the concrete spec then extends. Ticket AC "share fixtures through a trait" is covered by D2 and task 2.1.
- D2/risks shard claim: `backend/project/TestShards.scala` `lpt` gives unknown suites the median weight (`weights.getOrElse(n, default)`). `verifyExactlyOnce` only checks against discovered suites, so the stale weights row (`test-suite-weights.tsv:323`) is harmless. The claim holds.
- Hygiene: `scripts/check-test-temp-dir-hygiene.mjs` only flags raw `Files.createTempDirectory` etc. The fixture uses `newTempDir`, so no issue. `check-scala-quality.mjs` warns on files over 250 lines but does not fail, and the planned files are about 100-200 lines each.
- Premise evidence exists at `/home/matt/Development/helio/.concertino/runs/HEL-1293/evidence/premise-validation.md`.
- Scope: test-only, no production/CI/`PatchSetApplyResolvers` edits planned, and spinoff discipline is stated (D6, Non-goals). No placeholders/TBDs.

### Verdict: REFUTE

### Change Requests
1. **D5 check 2 (assertion-line multiset "must be identical") fails by construction, so the acceptance signal is wrong.** The regex includes `should `, and that matches the `should`-block subject lines. Probe: `grep -nE '<D5 regex>' PatchSetUndoServiceSpec.scala` matches line 203, `"PatchSetUndoService.undo" should {`. Under D1 that line will appear in three files (PanelDashboard, Lane, Refusal), so the multiset goes from 1 to 3. Check 2 therefore produces a non-empty diff even for a perfect verbatim split. That leaves the executor two bad choices: report a "failed" equivalence check, or quietly adjust the regex or the scoping until it passes. That is exactly the re-word-until-the-string-check-passes pattern a mechanical gate exists to prevent. Revise D5 (and task 3.1) to do one of the following, stated before execution:
   (a) Scope the assertion multiset to lines inside test bodies (`"..." in {` through the matching close). Subject lines and fixture lines are then excluded, and the fixture is compared separately as its own verbatim diff (allowing only `private` -> `protected` and the class-to-trait header).
   (b) Keep the whole-file multiset but enumerate the exact expected delta in advance: `"PatchSetUndoService.undo" should {` +2, and nothing else. Any other difference is a failure.
   Either way, write the pre-declared allowed delta into design.md so the evaluator can check it mechanically.
2. **D5 check 3 should also cover the fixture.** As written, checks 1-3 cover tests only. The fixture move ("verbatim except `private`->`protected` and doc-comment move", D2) has no mechanical check, but a silent fixture change (for example a different `beforeAll` order, a dropped `seedUsers()`, or a changed temp prefix) would change every test's behaviour without touching any assertion. Add a check: base lines 1-201 plus 710-714 vs the new trait plus `undoServiceWithoutOutputRepo` in RepoWiringSpec. Normalize `private ` -> `protected ` and drop imports/header, then diff. The expected result is empty.

### Non-blocking notes
- Task 1.1 runs `nice -n 19 sbt "testOnly ..."` without `HEL924_TEST_GROUP_CONCURRENCY=2`, the 600000 Bash timeout, or a following `sbt --client shutdown`. The ticket's driver constraints require these for sbt runs, so restate them in tasks 1.1/3.2 to keep the executor from drifting.
- D4's sentence "re-indentation where nesting depth is unchanged (it is ...)" is self-contradictory wording. The intent is clearly "no re-indentation", so say that.
- D6 is good. If any test fails in isolation, it should become an escalation, not a fix.
