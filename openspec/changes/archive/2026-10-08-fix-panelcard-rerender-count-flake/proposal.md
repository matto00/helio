## Why

The HEL-579 render-count regression test in `frontend/src/features/panels/ui/PanelCard.test.tsx` intermittently
fails on CI and in pre-commit Jest runs (`Expected: 2, Received: 3`), turning unrelated PRs red. Its baseline
"settle" is a fixed two-microtask flush, which is the leading suspect but has never been probe-confirmed; HEL-1373
classified a recurrence by reasoning only (its repeat runs all passed).

## What Changes

- Probe the failure to a confirmed root cause with a measured reproduction rate under a capped load recipe.
- Fix the confirmed cause. Expected shape: replace the fixed-tick baseline settle with one that waits for the
  mount-time async work it is meant to absorb, so the baseline is sampled only once settled. If the probe instead
  shows a genuine extra render in product code, fix that minimally (driver informed before any PanelCard.tsx edit).
- Keep the assertion exact (`toBe`); prove the test still fails when the `PanelCardBody` memo boundary is broken.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — test-reliability fix; no spec-level behaviour changes (`skip_specs: true`).

## Impact

- `frontend/src/features/panels/ui/PanelCard.test.tsx` (expected only file).
- Possibly `frontend/src/features/panels/hooks/useOutputMeta.ts` if the probe implicates it (behaviour-preserving).

## Non-goals

- Loosening the render-count assertion; raising test-worker caps; restructuring/splitting PanelCard (HEL-1365).
- Fixing other flaky tests (HEL-1353, HEL-1228) or CI configuration (HEL-1361).
