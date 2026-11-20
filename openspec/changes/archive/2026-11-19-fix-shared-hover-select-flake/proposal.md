## Why

Main CI is red: the HEL-1675 desktop hover test (light) fails in `e2e (2)` with `3 Select trigger must differ from rest on
hover`, in three consecutive CI runs (main@beb94adfe, PR #1188 twice), after passing on main@94a8ef292 and cfb6041bf.
It blocks every other lane (HEL-1777 is parked on it). The cause is not known; the fix must follow a probe-confirmed one.

## What Changes

- Establish a probe-confirmed root cause for the Select trigger reading its rest paint after `control.hover()` in the
  light desktop case, and commit the red probe that reproduces it before any fix.
- Fix whichever is wrong:
  - the test (`e2e/hel1675-shared-hover.spec.ts`), if it reads paint at a moment or pointer state that does not
    represent "rest" vs "hovered"; or
  - the product (the shared Select trigger's CSS), if a real mouse hover genuinely fails to paint, with a red-first test.
- Keep every existing assertion at full strength: hover must differ from rest, and must equal `DESKTOP_HOVER`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None at planning time. The change opts out of specs (`skip_specs: true`) because the expected fix is a test-only
correction. If the probe instead proves a product defect in Select hover paint, the executor adds a delta to the
existing capability that owns HEL-1675 hover gating and removes `skip_specs` (see design.md Decision 3).

## Impact

- `e2e/hel1675-shared-hover.spec.ts` (most likely), possibly `e2e/support/*` helpers it uses.
- Possibly the shared Select component stylesheet under `frontend/src` (only if the probe proves a product defect).
- No backend, schema, migration, or API change.

## Non-goals

- Hover gating across feature stylesheets (HEL-1735's scope) — escalated, not absorbed.
- Retries, `test.fixme`/skip, weakened assertions, or timeout increases without a probe proving timing.
- Re-weighting shards or changing CI worker counts.
