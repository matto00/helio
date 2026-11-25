## Why

`e2e/hel1573-motion-grid-chart.spec.ts:104` turned main red (run 45496270684, e2e (8)): the first chart canvas is not
visible within 5 s of `goto("/dashboards")`. HEL-1814 fixed this test's timing assertion; the first render under load is
a separate, still-unproven cause. A flaky test on main costs every lane a rerun and hides real regressions.

## What Changes

- Probe the first-render path under CPU throttling and record which step is still pending when 5 s lapses
  (seed run not terminal, chart chunk load, zero-size ECharts init, or plain host slowness).
- Fix at the root, per the proven cause (design.md D2): `/run` is already awaited to a terminal run, so the seed is
  not the expected cause; if the app is slow or misbehaves on first render, fix the app.
- No retries, no larger timeouts, no weakened assertion.
- Assess every other spec with the same canvas wait / `seedWorld` dependency; fix only those with the identical cause.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None expected (`skip_specs: true`): a test-seed fix changes no product behavior. If the probe proves an app defect whose
fix changes observable behavior, a spec delta is added then.

## Impact

- The CI failure evidence already implicates the frontend chart render path (data rendered in the table and metric,
  chart body empty), so a frontend fix there is likely, plus the env-gated throttle hook in
  `e2e/hel1573-motion-grid-chart.spec.ts`. Backend only if the probe contradicts the run-terminal reading. No migration.
- Red-run and probe evidence under `openspec/changes/first-chart-render-wait/`.

## Non-goals

- HEL-1647 (zero-size ECharts warnings on phone) unless the probe shows it IS this cause.
- Other C11 flakes not sharing this root cause.
