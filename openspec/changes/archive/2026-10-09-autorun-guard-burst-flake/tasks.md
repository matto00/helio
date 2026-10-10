## Standing Constraints

- [C1] Root cause is confirmed ONLY by Probe 1 (real wall-clock boundary, unchanged guard wiring) showing a count >3 with exactly two window_start rows 300s apart, each <=3, summing to the count; Probe 2 (clock jump) is illustration only and never justifies the fix. Loop iterations are green by log grep, never exit code alone.

## 1. Probe (root cause)

### Tests

- [x] 1.1 Search recent failed CI run logs for other `AutoRunGuardBurstProofSpec` failures (incl. which test, 3.1 or 3.2, failed in PR #883); record in files-modified.md
- [x] 1.2 Probe 1 (deciding, <=6 boundary-aligned attempts, else escalate): unmodified guard wiring + temp diagnostics give count >3 with exactly two window_start rows 300s apart, each <=3, summing to the count (one row => hypothesis refuted, escalate); mid-window start passes
- [ ] 1.3 Probe 2 (illustration only, never confirmation; not committed): guardClock jumping one window yields >3 runs (NOT RUN: illustration-only, skipped per C1; Probe 1 is the confirmation)

## 2. Fix

### Tests

- [x] 2.1 Pass the test's FakeClock (clockA/clockB for 3.2) as `guardClock` in AutoRunGuardBurstProofSpec; verify all 3 tests pass
- [x] 2.2 Re-run the probe-1 forced-boundary aiming against the fixed spec, logging per-fire wall times proving the boundary was crossed mid-burst; verify it passes
- [x] 2.3 30x loop under `nice -n 19`, <=4 workers, `-J-Xmx3g`, alongside 3 nice busy-loop shells (killed by recorded PID); every iteration green by log grep, not exit code
- [x] 2.4 Enumerate other guard-wired specs still on SystemClock with exact budget assertions; list as follow-ups in files-modified.md
