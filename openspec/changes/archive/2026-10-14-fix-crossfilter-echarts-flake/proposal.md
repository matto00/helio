## Why

`PanelCard.crossFilter.test.tsx`'s "Fullscreen's nested Inspect shows the SAME narrowed row…" test fails
intermittently in CI (twice on 2026-10-14, run 38553599277 and PR #1023's first attempt), turning unrelated PRs red
and costing re-runs on the morning of a release cut. The failure DOM shows the grid chart still in its lazy
`Suspense` fallback when `findAllByTestId("echarts")` gives up, which points at a timing assumption in the test, but
that is unconfirmed.

## What Changes

- Probe and confirm the root cause under CI-like conditions (CI=true, cold and warm transform cache, repeated runs,
  jest <= 3 workers, `nice -n 19`), recording the baseline failure rate.
- Remove the timing dependency the probe identifies (expected: the test's first-ever lazy `ChartPanel` load racing
  the default 1 s `findBy` window). No raised timeouts, no retries.
- Re-measure the failure rate after the fix over the same N repeats and record both numbers as evidence.
- If the failure cannot be reproduced, ship no code change: deliver an evidence-backed hypothesis report instead.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — test-only; `skip_specs: true`)

## Impact

- `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx` (expected only file).
- Possibly shared test helpers under `frontend/src/test/` if the probe shows the same exposure is shared.
- No product code change expected; no API, schema, or user-visible change.

## Non-goals

- Raising any `findBy`/`waitFor` timeout or adding `jest.retryTimes`.
- Removing or changing the production `React.lazy` code split in `ChartRenderer.tsx` (bundle-size behaviour, HEL-512).
- Fixing other chart suites with the same pattern unless the probe shows they are exposed; those go to a follow-up.
