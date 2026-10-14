## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `9a6aeb66c0d071d464f47d876219d7a1f22c0ac8` against the live-resolved base `27a30bb97289040c44c8fae547d7b2fa8df8a208` (`resolve-review-base.sh`, exit 0).

### What I verified (with evidence)

- **Diff scope.** `git diff --stat BASE...HEAD`: the only code files are `LateFinisherSpecBase.scala` (modified, +27/-11) and `LateFinisherSeamIsolationSpec.scala` (new). The rest are change artifacts. There is no `backend/src/main` change (C2, AC5). `LateFinisherRunSpec.scala` and `LateFinisherDeleteAfterWonSpec.scala` are not in the diff, so what they assert is byte-identical to the base.
- **AC1, hazard re-derived.** I read the base-side hunks in the diff. `GatedRunRepo` read `terminalWritten` inside `.andThen`. `HookSnapshotRepo` read `nodeWrites`, `foldDone` and `afterNodeWrite` inside `.flatMap`, and `nodeWrites` was a shared `val` reset with `set(0)`. `HookBackend` read `afterEngine` inside `.flatMap`. In `HookOutputRepo` and `HookBinaryRepo` (current file l.67-73 and l.119-125), every per-test read happens at call start: `binaryTarget` is destructured before `flatMap`, and `beforeBinaryWrite()` is invoked eagerly. They are correctly excluded, which matches evidence.md D1.
- **AC2, capture at start.** In the current file, `HookBackend` l.55 binds `hook = afterEngine`. `GatedRunRepo` l.86 binds `written = terminalWritten`. `HookSnapshotRepo` l.104-106 binds `counter`, `fold` and `hook`. `nodeWrites` is now a `@volatile var` that `resetSeams()` replaces with a fresh `AtomicInteger`, so the capture is meaningful.
- **AC3/AC4, red-first on fields the evaluator did not reproduce.** I reverted three captures together: `hook()` to `afterEngine()`, `fold.trySuccess` to `foldDone.trySuccess`, and `hook(n)` to `afterNodeWrite(n)`. Then I ran `nice -n 19 sbt -batch "testOnly com.helio.services.pipelines.LateFinisherSeamIsolationSpec"`:
  ```
  - should complete its own test's terminalWritten ... (GatedRunRepo)
  - should run its own test's afterEngine hook ... (HookBackend) *** FAILED ***   false was not equal to true (l.64)
  - should advance its own test's node-write counter ... (HookSnapshotRepo counter)
  - should invoke its own test's afterNodeWrite hook ... *** FAILED ***            false was not equal to true (l.89)
  - should complete its own test's foldDone ... *** FAILED ***                     false was not equal to true (l.105)
  Total number of tests run: 5 / Tests: succeeded 2, failed 3
  ```
  Exactly the three matching tests went red, and the two unmutated fields stayed green. That means each test is wired to its own seam and is not vacuous. The three mutations cannot mask one another: the afterNodeWrite mutation calls the new test's hook, not the fold, and the afterEngine seam sits on a separate class. The evaluator had already reproduced the terminalWritten and counter mutations. Together that covers all five.
- **Forced ordering, no sleeps (C1).** I read the new spec in full. Every hold is a test-owned `Promise`, and the test boundary is simulated by the same `resetSeams()` that `afterEach` calls. It uses no `Thread.sleep`, `eventually` or widened timeout. The 20-second `Await`s are completion bounds, not timing.
- **Restore + green.** I restored the file from a scratch backup, and `git diff --stat` on it was empty. Then I ran `testOnly LateFinisherRunSpec LateFinisherDeleteAfterWonSpec LateFinisherSeamIsolationSpec`: `Total number of tests run: 21`, `Suites: completed 3, aborted 0`, `Tests: succeeded 21, failed 0`, `[hel1468-guard] ... failed=0`. All three suite headers were printed, so tests executed.
- **The added `binaryTarget` reset.** `grep` shows every write of `binaryTarget` in `LateFinisherDeleteAfterWonSpec` (l.57, 77, 94) happens inside its test before use. Resetting it per test therefore removes cross-test leakage and changes no assertion.
- **UI.** N/A, there is no `frontend/**` in the diff.

### Verdict: CONFIRM

### Non-blocking notes
- The counter test (`LateFinisherSeamIsolationSpec.scala:68-76`) asserts only that the new counter is 0. Capturing the old counter and asserting it is 1 would make it two-sided, like the other four tests. I agree with the evaluator's suggestion.
- `LateFinisherSeamIsolationSpec.scala:96`: `Promise.successful(())` is simpler than the inline block.
- The spec's own doc comment states its limit: a call started after `afterEach` by a still-running chain is not covered. That is honest, and outside this ticket's AC.
