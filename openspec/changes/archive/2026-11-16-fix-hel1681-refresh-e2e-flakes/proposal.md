## Why

`e2e/hel1681-refresh-control.spec.ts` is the only failing spec on main CI (run 44014164481, e2e shard 3). It has
three distinct flakes: (1) a bare `.mobile-panel-stack__item` box read that can hit the fading loading-skeleton stubs
(null box -> `TypeError`), plus helpers that never wait out the skeleton; (2) a `.mobile-panel-stack` count-0 check in
the 1280 test asserted before anything mounts, so it passes vacuously; (3) the refresh-button tests at :128 (Enter
sends 0 requests) and :164 (tap never shows `aria-disabled="true"`), whose root cause is not yet known. HEL-1692's
PR #1132 is parked behind this.

## What Changes

- Wait for the real phone stack (`waitForPanelStack`, `LIVE_STACK_ITEMS`) before any stack-item read or measurement in
  the spec, including inside the shared `openDashboard` helper.
- Reorder the 1280 test so the `.mobile-panel-stack` count-0 check runs after `waitForPanelGrid`, and prove it can
  fail with a recorded mutation.
- Root-cause the :128/:164 refresh-button flake with a probe or CI trace before fixing it. Fix in the spec if it is a
  test race; if it is a product race, make a small, obvious product fix or escalate.
- Prove each fix red first under a forced repro, then `--repeat-each 20` green at 2 Playwright workers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only unless the root-cause probe finds a product race (then a small fix in the refresh registry/button,
or an escalation). No spec requirement changes, so `skip_specs: true`.

## Non-goals

- The e2e shard weighting issue HEL-1692 found (`scripts/e2e-shard.mjs`).
- Other specs' skeleton races or flakes (hel1277, hel1584, hel1578).
- Any refresh-control behavior change beyond a minimal race fix.

## Impact

`e2e/hel1681-refresh-control.spec.ts` (and possibly `e2e/support/`). Possibly a small change under
`frontend/src/features/panels/ui/grid/` or `frontend/src/app/dashboardMeta/` if the probe proves a product race.
