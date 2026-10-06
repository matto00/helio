## Standing Constraints

- [C1] Test count, test names and assertion lines are identical before and after, proven mechanically (sorted `diff`
  empty) and by a fresh runtime run of both versions; no new or changed assertions.
- [C2] Refactor discipline: bugs/dead code found are recorded as spinoffs, never fixed in this change.

### Backend

- [x] 1.1 Before editing, run the original `PipelineSchedulerServiceSpec` alone (`nice -n 19`, Bash timeout 600000) and save its JUnit XML `testcase@name` list + count to `hel1286-before-*` in the scratchpad; verify the run was fresh and non-zero
- [x] 1.2 Save the original file's sorted test-name literals and sorted assertion lines to `hel1286-before-*`
- [x] 1.3 Create `PipelineSchedulerServiceFixture.scala` (trait, `this: Suite =>`) holding the moved fixture verbatim with `private`→`protected`; verify it compiles
- [x] 1.4 Reduce `PipelineSchedulerServiceSpec.scala` to the 8 schedule-firing tests mixing in the trait; verify compile with no new warnings
- [x] 1.5 Create `PipelineSchedulerServiceMaintenanceHooksSpec.scala` with `historyFailureCase`, `FailingHistoryRepo`, its 2 cases and the outer-recover test, same `"PipelineSchedulerService.tick" should` subject; verify compile

### Tests

- [x] 2.1 Run both suites; save JUnit `testcase@name` list/count to `hel1286-after-*`; `diff` sorted names vs. before is empty and counts equal (expected 11)
- [x] 2.2 `diff` sorted assertion lines (excluding `import` lines and the `"PipelineSchedulerService.tick" should {` subject line) and test-name literals, original vs. new files + trait: expected exactly empty; per-test whitespace-normalised body equality passes
- [x] 2.3 Run `nice -n 19 sbt testFull` (Bash timeout 600000, <=2 concurrent groups) and pre-commit hooks; record result; keep full logs if anything fails
- [x] 2.4 Write `files-modified.md` and record spinoff candidates (e.g. unused `dtId` vals; untested product-event rollup hook) in the report, not fixed
