## Standing Constraints

- [C1] Every forced ordering uses promises/gates the test completes itself; no `Thread.sleep`, retry, `eventually`, or widened timeout in any committed code added by this change.
- [C2] No production (`backend/src/main`) code changes; a production defect found by the probe is escalated, not fixed.
- [C3] Every test-run claim in evidence (red-first, mutation, repeats) shows executed test counts or failing test names, never only an exit code (sbt 2 `testOnly` cache can run zero tests).

## 1. Probe

### Tests

- [x] 1.1 Factor the `afterEach` seam reset into `protected def resetSeams()` in `LateFinisherSpecBase` (behavior-preserving); verify existing late-finisher specs still compile and pass
- [x] 1.2 Add `LateFinisherSeamIsolationSpec` (design D3) with one forced-ordering test per captured field (terminalWritten, afterEngine, counter, afterNodeWrite, foldDone); run on the unfixed seams and record each test's red output in evidence.md
- [x] 1.3 Confirm in evidence.md, with cited code, that no passing existing test leaves a seam call in flight (only failing/timed-out ones do; design D1), and that `HookOutputRepo`/`HookBinaryRepo` are unaffected

## 2. Fix

### Tests

- [x] 2.1 Capture per-test state at call start in `GatedRunRepo`, `HookSnapshotRepo` (incl. per-test node-write counter) and `HookBackend` (design D2); verify the new spec goes green
- [x] 2.2 Mutation (design D4): revert each of the five captures on its own, verify its matching test goes red, restore; record all five in evidence.md

## 3. Verification

### Tests

- [x] 3.1 Run `LateFinisherRunSpec`, `LateFinisherDeleteAfterWonSpec` and `LateFinisherSeamIsolationSpec` together, 5 times, foreground, `nice -n 19`; record results in evidence.md
- [x] 3.2 Backend format/code-quality gates for touched files pass (the checks the pre-commit hook runs)
