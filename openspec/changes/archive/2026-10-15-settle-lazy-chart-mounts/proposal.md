## Why

HEL-1596 proved that a ~1 s main-thread stall landing after `findBy*` arms its 1 s deadline and before the lazy
`ChartPanel` mounts makes `PanelCard.crossFilter.test.tsx` fail with the exact CI DOM, and fixed that one file by awaiting
the causal promises inside `act`. At least 12 other frontend test files wait for the lazily mounted chart with
`findByTestId("echarts")`, so they may fail in CI the same way, turning unrelated PRs red.

## What Changes

- Probe `PanelCard.inspect.test.tsx`, `PanelCard.aggregateChart.test.tsx`, and every other frontend test that waits with
  `findBy*` for a lazily mounted chart, using HEL-1596's injected-stall method (scratch edits, never committed).
- For each exposed site, replace the deadline wait with the HEL-1596 pattern (await the causal promises inside `act`,
  then query synchronously), via a shared test helper under `frontend/src/test/` once it is reused by more than one file;
  migrate `PanelCard.crossFilter.test.tsx`'s local helper onto it.
- Record red-before / green-after evidence per converted suite and a full sweep inventory (converted vs left, with
  reasons) in `measurements.md`.
- No raised timeouts, no retries, no production code change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — test-only; `skip_specs: true`)

## Impact

- `frontend/src/test/` (new shared helper), `frontend/src/features/panels/ui/PanelCard.{inspect,aggregateChart,crossFilter}.test.tsx`,
  and any other swept test file the probe shows exposed.
- No product code, API, schema or user-visible change.

## Non-goals

- Raising any `findBy`/`waitFor` timeout or adding `jest.retryTimes`.
- Changing the production `React.lazy` split in `ChartRenderer.tsx` (HEL-512) or `MarkdownRenderer.tsx`.
- Finding the natural source of CI main-thread stalls.
- Converting sites the probe shows are not exposed (they are listed with the reason instead).
