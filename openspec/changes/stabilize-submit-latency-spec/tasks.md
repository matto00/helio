## Standing Constraints

- [C1] Never loosen or re-tune the timing threshold; no wall-clock comparison may decide pass/fail in the default suite.
- [C2] Contention harness: at most 4 workers total (the nice'd sbt run + at most 3 burners); kill load only by recorded PID.
- [C3] Scratch logs and probe variants live in the session scratchpad or are reverted; never committed, never in the change dir.
- [C4] Do not touch `.github/workflows/ci.yml`, `frontend/playwright.config.ts`, `.gitignore`, or product code.
- [C5] Owner ruling: AC1 is met by a documented non-reproduction at the worker cap (0/26, 0/63, 0/30) with honest H1/H2/H3 status; never claim a reproduction or proven root cause.

### Backend

- [x] 1.1 P1: reproduce the flake on the UNMODIFIED spec under contention; record k/N failures with sample arrays (scratchpad log).
- [x] 1.2 P2/P3: discriminate H1 (order/warm-up) vs H2 (non-stationary contention) via throwaway swapped + interleaved variants and per-sample arrays; record; revert.
- [x] 1.3 Replace each test's p50 assertion with D2's deterministic denied-pipeline counts (after == the 2 seeded AI ids with `ai-step`, before == 0).
- [x] 1.4 Gate the timed sampling and report lines behind `HELIO_MEASURE=1` with 5 warm-up iterations per phase and the >200ms p95-growth report line (D3); verify the env reaches the forked JVM.

### Tests

- [x] 2.1 Mutation: `triggerAutoRunAwaited` returns `Vector.empty` makes all three after-path assertions red; revert and confirm green.
- [x] 2.2 Run the modified spec 20+ consecutive times under the 1.1 contention harness; record k/N (expect N/N green).
- [x] 2.3 Run once with `HELIO_MEASURE=1` and capture the six `HEL-1096 submit-latency` report lines.
- [x] 2.4 Run `nice -n 19 sbt testFull` (timeout 600000, at most 2 workers); report any FirstRunRoutesSpec timeout or "Java heap space".
