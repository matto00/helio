## Standing Constraints

- [C1] Owner ruling: app-side early chart-module preload (low-priority/idle or modulepreload; must not delay first table/metric render; extend HEL-1760's preload, no duplicate); no test-wait change; siblings hel1573:405 and hel1584 ~:107/~:505 fixed in this PR, each red at 6x before and green after; state bytes cost and prod-build long-task check in the PR
- [C2] Owner ruling 2: keep the early preload AND add a state wait in hel1573:104 (Table row or Metric value visible after goto, then the unchanged canvas assertion at default 5 s); siblings only where they lack a page-state wait (waitForPanelGrid counts: leave and say so); each half proven by red + mutation at 6x, both halves 6x green N/N; :165 flake and waterfall shortening are follow-ups

- [C3] Owner ruling 3: drop the early preload (revert hook + wiring test), keep HEL-1760 preload, throttle switch, Table-cell state wait and preload measurements as evidence; fix :172 and :273 in this PR by probe-first root cause and a settled/observed-state or animation-itself measurement (no loosened bounds, retries or timeouts); each red at 6x + mutation; file-level 6x 20/20, 4x 5/5, 40/40, callers, prod-build 6/6. (C1 retired: preload dropped.)

## 1. Probe and red (Tests)

- [x] 1.1 `cd frontend && nice -n 19 npm ci`; create lane DB `helio_hel1651`; start servers via start-servers.sh with DATABASE_URL in the same command; verify health
- [x] 1.2 Add the env-gated `HEL1651_CPU_THROTTLE` hook to the chart test (unset = no CDP); verify unthrottled behavior unchanged
- [x] 1.3 Read the already-downloaded CI trace.zip/video (paths in design.md Context): network timing, DOM and console at failure; record findings
- [x] 1.4 Reproduce the canvas-wait failure at 4x (else 6x); commit the red run as `.txt` before any fix code
- [x] 1.5 Probe each candidate (run status, chart chunk, canvas box size, card content, host CPU) at timeout; record results as evidence and name the root cause

## 2. Fix (Tests / Frontend per D2)

- [x] 2.1 Apply the D2 branch for the proven cause (an app fix in the chart render path with a red-first jest test is the expected branch); verify the probe now shows the canvas
- [x] 2.2 Mutation: revert only the fix, re-run at the red throttle rate, record red as `.txt`; restore

## 3. Verification (Tests)

- [x] 3.1 Full spec file 40/40 (`--repeat-each=10`, 2 workers, nice -n 19), recorded as `.txt`
- [x] 3.2 Chart test 5/5 at `HEL1651_CPU_THROTTLE=4`, recorded as `.txt`
- [x] 3.3 Run every `seedWorld` caller spec file once (2 workers) and record results
- [x] 3.4 Confirm the spec file still has exactly 4 tests (so 40/40 = --repeat-each=10); write the sibling assessment (D4) into the evidence; lint/typecheck/format pass
- [ ] 3.5 (orchestrator) Record the PR's own CI job ids and that hel1573-motion-grid-chart:104 passed with no rerun
