## Standing Constraints

- [C1] Root cause is confirmed ONLY by the D1 real-wall-clock-boundary probe on unchanged guard wiring (two window_start rows one window apart); a clock-jump guardClock is illustration only. Loop iterations are judged green by log grep, never exit code alone.
- [C2] Do not edit any `EmbeddedPostgres.builder()...start()` line (HEL-1445 owns them); probe edits are temporary and never committed.

## 1. Probe (root cause)

### Tests

- [x] 1.1 D1 probe on unmodified wiring (temp shrunk window + aimed real boundary, <=6 attempts): capture failing assertion, per-submission wall times, and two window_start rows; save transcript
- [x] 1.2 Confirm every test in the spec uses a fresh owner (no budget leakage under a shared pinned instant)

## 2. Fix

### Tests

- [x] 2.1 Add a pinned mid-window guard clock and pass it as `guardClock` in `newService` and `newGatedService`; assert exact `retryAfterSeconds` (1800) in the (limit+1)th test; correct the HEL-1195 comment
- [x] 2.2 Re-run the D1 aimed-boundary probe against the fixed spec; logged wall times prove the boundary was crossed; test passes
- [x] 2.3 Full spec green; 20x loop under `nice -n 19`, `-J-Xmx3g`, judged by log grep; confirm `[hel1468-guard]` line present
- [x] 2.4 D4 sweep: classify every other guard-wired / rate-window spec; fix boundary-sensitive ones; record all in files-modified.md
