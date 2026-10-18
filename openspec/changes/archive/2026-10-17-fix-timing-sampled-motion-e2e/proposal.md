## Why

Main CI is red on e2e shard 4 since HEL-1584 merged: three e2e tests sample timing-dependent state (a motion log read
once, rAF frames counted in a fixed window, a layout box read mid-entrance) and fail on a slow runner. Every other lane is
blocked on green CI.

## What Changes

- `e2e/hel1584-motion-surfaces.spec.ts` save-check test (:562): poll the motion log for the check's pop instead of
  reading it once.
- `e2e/hel1584-motion-surfaces.spec.ts` chart-refresh morph test (:487): wait on the chart's animation state (zrender
  animation clock / settled final value) rather than a fixed 1800 ms window, and assert a morph that a hard cut cannot
  pass, without counting on >= 2 rAF samples inside a 280 ms tween.
- `e2e/hel1260-orphan-owner-repair.spec.ts` UI-create test (:108): read grid-item boxes only once the layout box is
  non-null and stable (entrance settled), before and after reload.
- Same read-once / fixed-window pattern elsewhere in `hel1584-motion-surfaces.spec.ts` and the HEL-1573 motion specs:
  fix where clearly shared, list the rest.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change; no product behavior changes (`skip_specs: true`).

## Impact

E2E specs and possibly `e2e/support/motionRecorder.ts` / a small e2e helper. No frontend or backend code.

## Non-goals

- Product-code changes (a probe-proven app defect is escalated, not fixed here).
- Retries, longer timeouts, or loosened thresholds.
- CI config/sharding changes.
