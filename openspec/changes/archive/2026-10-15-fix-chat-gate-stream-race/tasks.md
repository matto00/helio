## Standing Constraints

(none)

## 1. Investigation (probe before fix)

- [x] 1.1 Pull the failing CI log for 7c3e29867 (PR #1026, backend shard 3); record the exact failure text in evidence
- [x] 1.2 Baseline rate: N>=30 `testOnly ...ClaudeRoutesChatGateSpec` runs under capped CPU contention, plus >=3 CI-shaped shard runs (`HEL924_TEST_GROUP_CONCURRENCY=2`); record failures/N and executed counts
- [x] 1.3 Latch probe (design D1b: transport `stream()` blocks on a latch released after `before` is read) gives red `2 was not equal to 1` at line 254, or refutes H1
- [x] 1.4 Record root-cause verdict (test race vs production defect) in `evidence.md` in the change dir


## 2. Fix

### Tests

- [x] 2.1 Drain the `?stream=true` response in the beta shared-counter test and assert it contains the `authoring-result` event; verify spec green
- [x] 2.2 Pin `before shouldBe 2` explicitly; keep line-254 assertion unchanged; verify spec green
- [x] 2.3 Apply the same drain to any other stream-OK check in this spec that precedes a transport-count assertion

## 3. Verification

- [x] 3.1 D5(i): delayed-increment probe transport with the fix -> green, `before` = 2
- [x] 3.2 D5(ii): same delay, drain removed -> red at `before shouldBe 2`; restore
- [x] 3.3 D5(iii): 429-preserving synchronous mutation (design D5(iii)) -> red AT line 254 (`3 was not equal to 2`) with fix in place; restore -> green
- [x] 3.4 After rate: same N/conditions as 1.2; record failures/N and executed counts with this worktree's paths
