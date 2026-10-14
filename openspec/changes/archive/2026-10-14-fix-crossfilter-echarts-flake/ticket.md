# HEL-1596: Flaky jest test on main: PanelCard.crossFilter "Fullscreen's nested Inspect shows the SAME narrowed row…" can't find [data-testid="echarts"]

## Description

Intermittent frontend-job failure seen twice on 2026-10-14:

* main push CI for 71e058436 (HEL-1565), run 38553599277;
* PR #1023's first CI attempt (HEL-1451, no frontend diff); a re-run of the failed job passed.

Failing test: `PanelCard.crossFilter.test.tsx`, describe "PanelCard — HEL-588 grid vs Fullscreen Inspect agree on row
content (evaluation-3.md CR1/CR2)", test "Fullscreen's nested Inspect shows the SAME narrowed row as the grid card's,
not every quarter". Error: `Unable to find an element by: [data-testid="echarts"]`, after timer activity
(`listOnTimeout` frames in the log).

Do: reproduce under CI-like conditions (CI=true, a 4-vCPU worker count, repeated runs) and find the root cause. Likely
suspects are a timing-dependent lazy chart mount, a findBy timeout or test-order leakage, but nothing is confirmed.
Prove the fix by showing the failure rate before and after over N repeats, per the systematic-debugging law. Do not
just raise a timeout.

## Acceptance Criteria (from the ticket and the driver's brief)

- Root cause is probe-confirmed (systematic-debugging law) before any fix is written.
- Failure rate measured under CI-like conditions (CI=true, repeated runs, local cap: jest <= 3 workers, `nice -n 19`)
  BEFORE and AFTER the fix, over N repeats, with the numbers recorded as evidence.
- The fix is NOT a raised timeout and NOT a retry.
- If the failure cannot be reproduced locally: no speculative patch — the deliverable is an evidence-backed hypothesis
  report (CI log analysis + the test's timing assumptions).
- Test-only expected. If the root cause is a product bug in PanelCard/Fullscreen, fix it only when user-visible
  behaviour is unchanged; otherwise escalate and stop.

## Orchestrator's pre-planning observations (claims to verify, not facts)

- One failure per CI run, in two independent runs (38553599277, and PR #1023's run 38567142582 attempt 1), both at
  line 369:37 — the GRID card's `findAllByTestId("echarts")`, not the Fullscreen `findByTestId` at line 397. Each run
  is a single jest invocation (no `retryTimes`); the second occurrence in 38553599277's log is jest's
  "Summary of all failing tests" reprint, not a retry.
- Both failure DOM dumps show the chart canvas still holding `suspense-fallback suspense-fallback--panel`
  ("Loading data"): `ChartRenderer.tsx:19`'s `React.lazy(() => import("../ChartPanel"))` had not resolved.
- This describe block is the LAST in the file and the only one rendering a chart, so it is the first point in the
  file where ChartPanel's module graph is loaded (and, on a cold CI transform cache, ts-jest-transformed).
