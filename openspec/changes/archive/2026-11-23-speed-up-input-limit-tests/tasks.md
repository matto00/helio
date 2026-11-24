## Standing Constraints

- [C1] Test-only: no app code change committed and no assertion of either test changed.
- [C2] Red/measurement evidence first: before-timings and helper-alone timings committed before the helper change.

## 1. Measure (before)

- [x] 1.1 Time each helper alone (old code, both targets each test uses) and record in `helper-timing-before.txt`.
- [x] 1.2 Run both full spec files locally; extract per-test JUnit times into `timing-before.txt`. Commit 1.1/1.2.

## 2. Fix

- [x] 2.1 Replace the linear walk in `sized` (AssistantServiceFailureBudgetSpec) with an O(log n)/O(1) search
  against the real estimator, plus the boundary `require` (design D2, D3).
- [x] 2.2 Same for `sizedMessage` (AssistantConversationRoutesTierSpec).
- [x] 2.3 Equivalence probe old vs new `k` for each target; record `equivalence-probe.txt` (design D4).

## 3. Prove

- [x] 3.1 Mutate the limit check (app code, temporary), run both full spec files, record reds in
  `mutation-red-*.txt`; revert and confirm `git diff` of `backend/src/main` is empty (design D5).
- [x] 3.2 Re-run both full spec files; per-test JUnit times into `timing-after.txt`; all green.
- [x] 3.3 Note in the PR that `test-suite-weights.tsv` is not regenerated (needs main CI runs with the fix).
