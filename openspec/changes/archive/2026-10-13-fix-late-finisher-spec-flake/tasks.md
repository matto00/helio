## Standing Constraints

- [C1] The fix sequences the spec with `terminalGate` (promise completed on delete success AND failure); no retry, sleep, or widened timing; delays exist only in probes and are removed before commit.

## 1. Probe (root cause before any fix)

### Tests

- [x] 1.1 Run the unmodified spec once (`nice -n 19 sbt "testOnly com.helio.services.pipelines.LateFinisherRunSpec"`) and record the baseline result in evidence.md
- [x] 1.2 Red probe A (design D2): force the terminal write to commit before the hook's delete; verify the unfixed D7 test fails with `Right(RunResultResponse(...))`; record probe diff + output in evidence.md
- [x] 1.3 Red probe B (design D2): delay the hook's delete; verify the unfixed D7 test fails the same way; record in evidence.md (if neither probe reproduces, follow design D2: record it and investigate H2 before changing anything; escalate if H2 also fails to explain it)
- [x] 1.4 Investigate H2 (design D6): shared-DB/global reap under group concurrency; record the finding with cited harness code in evidence.md

## 2. Fix

### Tests

- [x] 2.1 Sequence the D7 delete test with `terminalGate` held until the delete completes (design D3); verify probe B is now green with the fix applied
- [x] 2.2 Audit siblings (design D4): run probe B against each exposed test, fix those that go red, record per-test outcome in evidence.md
- [x] 2.3 Decide and record design D5 (optional positive pin); if added, verify it passes deterministically
- [x] 2.4 Remove all probe-only code (delays, temporary hooks) from the committed spec; verify `git diff` shows only the sequencing fix (+ D5 if chosen)

## 3. Verification

### Tests

- [x] 3.1 Mutation M6: replace `failIfLostTerminalWrite` body with `Future.unit`, verify the fixed D7 delete test goes red, revert, record in evidence.md
- [x] 3.2 Repeat the spec at least 10 times under CPU load (state the exact load method; at most 3 workers, nice -n 19), foreground; note that `HEL924_TEST_GROUP_CONCURRENCY=2` has no effect on a single-spec `testOnly` (build.sbt:200-208) unless run alongside another forked group; record exact runs and results in evidence.md
- [x] 3.3 Backend lint/format gates for the touched file pass (scalafmt/code-quality check used by the pre-commit hook)
