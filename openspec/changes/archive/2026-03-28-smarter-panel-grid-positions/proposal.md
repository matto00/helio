## Why

New panels currently stack vertically at the top-left of the grid because the fallback layout generator assigns positions by index without checking existing occupied space. This forces users to manually rearrange panels after every creation, degrading the out-of-the-box dashboard experience.

## What Changes

- Introduce a `findNextAvailablePosition` utility in `dashboardLayout.ts` that scans existing layout items for the first open slot (row-first, left-to-right) that fits the default panel dimensions for a given breakpoint
- When `resolveDashboardLayout` generates fallback positions for panels missing from the saved layout, use the smart position finder instead of the sequential index formula
- Fall back to appending a new row at the bottom when no horizontal slot is available
- Apply the smart placement at all four breakpoints (lg, md, sm, xs)

## Capabilities

### New Capabilities

- `smart-panel-placement`: Logic for computing the next available grid position given existing layout items and grid column count, placing panels left-to-right and wrapping to new rows only when needed

### Modified Capabilities

- `frontend-layout-persistence`: The requirement for fallback position generation is tightened — missing panels now receive smart-computed positions rather than naive index-based ones

## Impact

- `frontend/src/features/dashboards/dashboardLayout.ts`: new utility function, updated `createBaseLayout` to use it
- `frontend/src/features/dashboards/dashboardLayout.test.ts`: new tests for smart placement
- No API changes, no backend changes, no new dependencies
