## Standing Constraints

## 1. Probe (before any fix)

- [x] 1.1 Reproduce under contention (≤3 forks or ≤3 niced load PIDs, ≤4 workers); record runs/failures/failing test+assertion in probe.md
- [x] 1.2 Deterministic mechanism probe (scratch delay >50 ms before the live leg of test 2, reverted); record red output in probe.md
- [x] 1.3 Confirm or refute the hypothesis in probe.md; on refute or product bug, return ESCALATION per design D0/D4

### Backend

- [x] 2.1 Add `clock: Clock = SystemClock` to ConnectorCompletionService; replace all Instant.now(); verify compile
- [x] 2.2 Add `clock: Clock = SystemClock` to ConnectorCompletionTokenRepository; replace all Instant.now(); verify compile
- [x] 2.3 Confirm ApiRoutes and SourceServiceSpec compile unchanged (grep shows no edits needed)

### Tests

- [x] 3.1 Rewrite the three 50 ms tests with a per-test FakeClock shared by service + repo (incl. test 1's isValid check); advance well past expiry (µs truncation); no Thread.sleep; assertions kept; green
- [x] 3.2 Record D3 proofs in probe.md (≥500 ms sleep still green; consume/resolve clock-bypass mutations red; expiry-predicate mutation red)
- [x] 3.3 Run the identical contended setup from 1.1 (same forks/load PIDs, stated in probe.md) ≥20 consecutive times post-fix, tests executed, 0 failed
- [x] 3.4 `nice -n 19 sbt testFull` green (Bash timeout 600000); then `sbt --client shutdown` as a separate call
- [x] 3.5 Update MISTAKES.md CI note for this flake; write 3-fork recommendation + residue section in probe.md
