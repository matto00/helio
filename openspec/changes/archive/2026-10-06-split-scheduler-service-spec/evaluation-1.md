## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 644cbf7e08f318a8cab973751a99bedbf283c339. Base resolved live with `resolve-review-base.sh`: f78b4c5187a42ead6bf71eb6dce9070b020eda63.
`main` has moved since then (b2a0d8088, HEL-1337), but none of those commits touch `backend/src/test/scala/com/helio/services/pipelines/`. No drift.

I derived all evidence below myself from `git show f78b4c518:<original path>` and kept it in the scratchpad (`hel1286-eval-*`).
The executor's copy of the original file (`hel1286-original-spec.scala`) is byte-identical to mine (`cmp`). I used it only to cross-check.

### Phase 1: Spec Review — PASS
Issues: none.
- AC1, concern split with a shared trait: `PipelineSchedulerServiceFixture` (trait, `this: Suite =>`) is mixed into `PipelineSchedulerServiceSpec` (8 schedule-firing tests) and `PipelineSchedulerServiceMaintenanceHooksSpec` (3 retention-hook tests). No setup is copied between them.
- AC2, same count and no new assertions: verified mechanically and at runtime (see C1 below).
- Premise drift: the ticket says the spec covered a product-event rollup hook, but it never did. design.md records this as a spinoff candidate and does not add a test, which is correct under C2.
- All tasks.md items are checked and match the diff. Nothing outside `backend/src/test/.../pipelines/` changed apart from the change's own openspec artifacts. `skip_specs: true` fits a pure test refactor.
- C1 (counts, names and assertions identical, proven mechanically): honoured. My checks:
  - Assertion lines (`should|shouldBe|noException|thrownBy`, excluding imports and the subject line), sorted: 34 vs 34, **diff empty**.
  - The subject line `"PipelineSchedulerService.tick" should {` appears once before and twice after (once per spec), as design Decision 4 intends.
  - Test-name literals (`"..." in {` and `historyFailureCase("...")`), sorted: 11 vs 11, **diff empty**.
  - Stronger check: I took the multiset of every non-import, non-blank, whitespace-trimmed line, with a leading `private ` normalised to `protected `. Across original vs. the three new files, the only differences are the new class/trait header lines, the extra `package` lines and closing braces, the new doc-comment lines, and the second subject line. **No test-body, fixture or helper line was added, removed or changed** (`hel1286-eval-lines.diff`).
  - Relative test order is preserved in both files.
- C2 (refactor discipline): honoured. Dead code moved over unchanged, e.g. the unused `dtId` vals in `PipelineSchedulerServiceFixture.scala:142,161` and the blank lines inside `DBIO.seq`.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH. Backend only, so no frontend gates.
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: exit 0. **6038 tests, 428 suites, 0 failed, 0 aborted.** Log: `hel1286-eval-testfull.log`.
- Fresh JUnit XML from that run, written after the run started at 07:30:24:
  - `TEST-...PipelineSchedulerServiceSpec.xml` (07:34:57): `tests="8"`, 0 failures/errors/skipped.
  - `TEST-...PipelineSchedulerServiceMaintenanceHooksSpec.xml` (07:31:48): `tests="3"`, 0 failures/errors/skipped.
  - Total 11.
- Runtime names: the sorted `testcase@name` list across both XMLs equals the before list I built statically from the original source. **diff empty, 11 = 11.** The executor's before-run XML (`tests="11"`, timestamp 07:13:53) matches the same static list. The original registers all 11 tests unconditionally, so the static count is exact.
- CONTRIBUTING.md:
  - No inline FQNs. The redundant same-package import `com.helio.services.pipelines.{PipelineRunService, PipelineSchedulerService}` was dropped correctly.
  - Every import in all three files is used. I spot-checked each spec-file import by grep.
  - All files are under the ~250-line soft budget (197 / 183 / 70; the original was 414).
  - The new doc comments state their content inline, not just a ticket reference.
  - No TODO/FIXME.
- The visibility change matches design Decision 2: trait-level `private` became `protected`, and the nested `FakeClock`'s `@volatile private var instant` stays `private`.
- Per-suite Postgres isolation is unchanged: the fixture state lives in a trait, not a shared object.
- Note: testFull reported `cache 100%`, so this run produced no compiler output and I could not check for new warnings from the log. The import usage check above stands in for the only warning class this change could plausibly add (unused imports).

### Phase 3: UI Review — N/A
Backend test-only change. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` files changed.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Spinoff candidates for the final report (do not fix here, per C2):
  - The unused `dtId` vals in both seeders.
  - The product-event rollup hook on `tick` has no test anywhere in this spec family.
