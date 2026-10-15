## Why

The overview row double-click e2e tests compute a gesture point once the row's top stops moving, but the web-font swap
(rows 55px -> 53px, 100-250ms after first paint) can land after that and move the target under the pointer. CI runs
with `retries: 0`, so this is a latent low-single-digit-percent flake (1 in 33 observed locally during HEL-1605).

## What Changes

- New shared e2e helper in `e2e/support/` that waits until the page's web fonts have actually finished loading (not
  vacuously "loaded" because the non-blocking font stylesheet has not applied yet), bounded, failing loudly on timeout.
- `settledRowTop` (`e2e/support/rowDeleteGesture.ts`), which every row double-click in both specs reaches before its
  gesture point (directly or via `placeBottomNearViewportEdge`), calls it once the target row is visible.
- Before/after flake measurement under `--repeat-each` with a probe that reproduces the font-swap shift on demand.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-harness only; no product behaviour changes (`skip_specs: true`).

## Impact

- `e2e/support/` (new helper + `rowDeleteGesture.ts`), `e2e/hel1574-shell-rail.spec.ts`,
  `e2e/hel1605-row-delete-confirm.spec.ts` (only if a call site needs it).
- No frontend/backend code, no config, no CI change.

## Non-goals

- The optional product AC (font preload / metric-matched fallbacks). It is a UI/visual change and out of scope for
  this unattended test-only run; recorded for a separate follow-up if wanted.
- Retries, raised timeouts, or `test.fixme`/skip as a "fix".
- Sweeping every other e2e spec onto the helper; only the row double-click specs adopt it here.
