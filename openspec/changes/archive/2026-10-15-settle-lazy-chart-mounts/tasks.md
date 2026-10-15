## Standing Constraints

- [C1] No raised timeouts and no retries; no conversion of a site without a probe result for its file.
- [C2] All probes/tests: jest <= 3 workers, `nice -n 19`, <= 3-4 parallel processes, strictly sequential executors, run in this worktree only; Bash `timeout: 600000`; never pkill/pgrep/killall.
- [C3] Stall injection is scratch-only (never committed); a stalled run counts only if the stall fired.

### 1. Probe

- [x] 1.1 Inventory per design.md "Sweep definition" (real or mocked ChartPanel behind the lazy ChartRenderer; findBy*/findAllBy*/waitFor); record the literal grep commands, every candidate site file:line, and each excluded candidate with its reason
- [x] 1.2 Probe `PanelCard.inspect.test.tsx` and `PanelCard.aggregateChart.test.tsx` with the HEL-1596 stall (getOutputById resolution microtask, 1200 ms, N=5, whole file and per-test where relevant); record before results + one failure DOM
- [x] 1.3 Probe every other swept file per design.md D1; record results

### 2. Fix

- [x] 2.1 Add `frontend/src/test/settleChartMount.ts` (why-comment) and migrate `PanelCard.crossFilter.test.tsx` onto it
- [x] 2.2 Convert every exposed site (await causal promises in act, then synchronous query)
- [x] 2.3 Leave unexposed sites unchanged; record reason per site

### 3. Verify

- [x] 3.1 After: same stall, same N, per converted file (and crossFilter's own HEL-1596 stall) — all green, fired == N
- [x] 3.2 Clean after: 10 cold-cache CI=true runs per converted file, green
- [x] 3.3 Regression guard: one scratch assertion mutation per converted file turns it red
- [x] 3.4 Write `measurements.md` (commands, env, cwd, N, results, sweep inventory table)
- [x] 3.5 Gates: eslint, prettier, typecheck, `jest src/features/panels src/features/dashboards src/test` (CI=true, nice -n 19, --maxWorkers=3); commit
