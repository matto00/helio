## Why

The HEL-1790 forced-condition guard (`e2e/hel1790-hover-probe.spec.ts`) has twice hung its dark case for the full
240 s test timeout on CI (main run 44873260203 job 136752280174; PR #1197 run 44803300832 job 136532369427). The CI log
places the hang at spec line 37, the first `page.waitForFunction`, which polls once per animation frame for the step
sheet's Select trigger to straddle the stationary pointer row (`r.top <= 360 && r.bottom >= 366`) while the sheet slides
in. The trace shows the sheet did open. A 4-minute hang costs a leg its headroom (HEL-1793), and the wait has no bound
of its own.

## What Changes

- Establish a probe-confirmed root cause for why that condition is never observed true (in dark, on CI) before any fix,
  and commit the red probe first.
- Fix the wait or the probe so the forced condition (the trigger under the pointer mid-slide, then a main-thread stall
  as the slide lands) is reached deterministically, not by sampling a sub-frame window.
- Give every wait in the spec a short explicit timeout with a message naming the state it observed, so an unreachable
  precondition fails in seconds, not at the 240 s test timeout.
- Keep the guard's assertion and its ability to fail: the HEL-1790 mutations (`settleToRest` replaced by a no-op, or by
  `noAnimations` alone) must still turn it red.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change (`skip_specs: true`). If the probe instead locates the cause in app code, the executor stops and
the orchestrator escalates (design.md Decision 4).

## Impact

- `e2e/hel1790-hover-probe.spec.ts`; possibly `e2e/support/hel1790Rest.ts` (shared with `e2e/hel1675-shared-hover.spec.ts`
  and `e2e/hel1735-feature-hover.spec.ts`, whose behaviour must not change).
- No frontend, backend, schema, migration or API change.

## Non-goals

- Changing `e2e/hel1675-shared-hover.spec.ts` or `e2e/hel1735-feature-hover.spec.ts` assertions or behaviour, shard weights, CI worker counts or the test timeout policy.
- Retries, `test.fixme`/skip, or weakening `expect(early).toBe(settled)`.
