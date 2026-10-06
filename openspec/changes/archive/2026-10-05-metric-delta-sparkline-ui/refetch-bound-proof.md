# Refetch-bound proof (HEL-1275)

Test: PanelContent.metricHistory.test.tsx, "a compare saved after the history was cached hides the stale delta and refetches once" (fetcher returns a fresh object per call, budget 5, then never resolves).

## RED: bound removed (the `done` early-return at useOutputHistory.ts:59 replaced by `void done;`, temporarily, then reverted)
```
FAIL src/features/panels/ui/PanelContent.metricHistory.test.tsx
  ● PanelContent — metric history (HEL-1275) › a compare saved after the history was cached hides the stale delta and refetches once

    expect(jest.fn()).toHaveBeenCalledTimes(expected)

    Expected number of calls: 2
```
Received 6 calls (the budget of 5 plus the initial load): the refetch loops.

## GREEN: bound restored
```
Tests:       14 passed, 14 total
```
