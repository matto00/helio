## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `56826a4f9f483871fe6a3fc5d28d475536a11911` against live-resolved base `941f18817777aeae076c45ac4a0a0e79d7847588`
(`resolve-review-base.sh`, origin/main). Code diff: one file,
`backend/src/test/scala/com/helio/services/pipelines/LateFinisherRunSpec.scala` (+18/-1). The rest is the change directory.

All sbt runs: from the worktree's `backend/`, `nice -n 19 sbt -batch -Dsbt.server.autostart=false "testOnly com.helio.services.pipelines.LateFinisherRunSpec"`,
foreground. Every run's `loading project definition` line named this worktree. Every run's `[hel1468-guard]` summary matched its
`Tests:` line. Probe and mutation edits were applied by script and reverted with `git checkout -- backend` after each run.
`git status` was clean at the end.

### Phase 1: Spec Review — PASS
- AC1 (root cause confirmed by a probe): reproduced independently. **Probe B** (hook = 1500 ms delay, then delete) applied to the
  **unfixed** D7 test (the original `beforeOutputList = () => deletePipeline(fx)` with no gate) went red with the exact CI
  signature: `Right(RunResultResponse(Vector(... 3 rows ...), 3, ...)) was not equal to Left(NotFound("Pipeline not found: ..."))`,
  `Tests: succeeded 10, failed 1`.
- AC2 (classification): the "test-only" classification holds. When the run's own eager `succeeded` write commits first,
  `won = true`, and returning `Right` is HEL-1518 D7's "first terminal write wins". `PipelineRunSucceededWrites.scala:304-309`
  is unchanged.
- AC3 (no retry, sleep or widened timing): met. The fix holds `terminalGate` until the delete finishes. It uses
  `andThen { case _ => deleted.trySuccess(()) }`, which also fires on delete failure. The committed diff has no sleep, retry or
  `eventually`. Constraint C1 is honored.
- AC4 (red-then-green and mutation): the **same probe B** applied to the **fixed** test passed (`succeeded 11, failed 0`).
  **M6** (`if (won || pipelineRunRepo == null)` -> `if (true)`) turned the fixed D7 delete test red (`Right` vs `Left(NotFound)`),
  and the D7 reap test red as well (`succeeded 9, failed 2`).
- AC5 (sibling audit): confirmed by my own probe. The item-2 "deleted in that window" test with a 1500 ms delayed delete in
  `beforeNodeFold` stayed green (`succeeded 11, failed 0`). Reading the code gives the same answer: the hook completes before
  the node fold, so every node guard sees the run as Missing whichever terminal-write order happens. The item-1 tests act before
  the success chain starts.
- AC6 (repeat runs): 5 consecutive runs of the clean fixed spec under 3 `nice -n 19` busy loops, all `succeeded 11, failed 0`.
  The executor correctly notes that `HEL924_TEST_GROUP_CONCURRENCY` has no effect on a single-spec `testOnly`. The deterministic
  probe B result is the stronger proof.
- H2 claim checked: `OutputHistoryApiHarness.scala:69` starts a per-spec embedded Postgres in `startHarness()`, and
  `NodePayloadFixtures` extends that harness.
- Tasks are all marked [x] and match the implementation. There is no scope creep, no API or schema change, and files-modified.md
  uses repo-relative paths.

### Phase 2: Code Review — PASS
Gates run fresh:
- `sbt "Test/compile"`: success. The full suite was not run: `testFull` takes longer than 600 s and the change touches only this
  one spec. What ran is listed here exactly.
- `LateFinisherRunSpec` on clean HEAD: `succeeded 11, failed 0` (twice, plus 5 repeats under load).
- `npm run check:scala-quality`: clean, exit 0. The 365-line soft-budget warning on the spec already applied to the base file at
  ~349 lines.
- `check:openspec`, `check:spec-structure`, `format:check`, `check:repo-integrity`: all exit 0.

Is the D5 positive pin (`LateFinisherRunSpec.scala:222-229`) deterministic and non-vacuous?
- **Deterministic:** the hook waits on `terminalWritten`, which `GatedRunRepo` completes after the terminal write returns, before
  it deletes. Probe: I slowed the run's own write with `terminalGate = Future { Thread.sleep(1500) }` and the pin stayed green
  (`succeeded 11`). The ordering is enforced by the promise, not by timing. Leakage between tests is also ruled out:
  `terminalWritten` is reset in `afterEach`, and its `andThen` callback sits inside the future chain that `submit` awaits, so the
  previous test's write cannot complete a later test's promise.
- **Non-vacuous, and the only test that catches this case:** mutation **M8**, which lets a later delete override a write the run
  already won, made **only the pin** fail (`false was not equal to true (LateFinisherRunSpec.scala:227)`, `succeeded 10, failed 1`).
  M8 replaces `if (won || ...)` with a `runStateInternal` check that returns `Future.unit` only for `Open` or `Terminal if won`,
  so `Missing` fails even when the write won. A broader mutation, M7 (drop `won`), made the pin fail together with the existing
  healthy control.

Code quality: the fix copies the existing reap tests' `terminalGate` pattern (DRY). The comments explain why. The code has no
dead code and no type escape hatches.

### Phase 3: UI Review — N/A
This is a test-only backend change. No Phase 3 trigger path (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`)
changed.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `LateFinisherRunSpec.scala:227`: `res.isRight shouldBe true` gives a bare `false was not equal to true` on failure.
  `res shouldBe a[Right[_, _]]`, or matching on the value, would show the actual `Left`. The existing healthy control (line 263)
  uses the same style, so this is optional.
- The pin could also assert `count("pipelines", "id", fx.pid.value) shouldBe 0` to document the end state. `deletePipeline`'s
  `require` already enforces it implicitly.
