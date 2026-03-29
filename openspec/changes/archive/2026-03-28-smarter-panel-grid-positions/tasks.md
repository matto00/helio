## 1. Core Algorithm

- [x] 1.1 Add private `findNextAvailablePosition(placed, colCount, itemWidth, itemHeight)` function to `dashboardLayout.ts` that scans row-by-row, left-to-right for the first non-overlapping slot, falling back to a new row at the bottom
- [x] 1.2 Refactor `createBaseLayout` to call `findNextAvailablePosition` incrementally for each panel instead of computing positions by index formula

## 2. Tests

- [x] 2.1 Add test: first panel on empty grid is placed at x=0, y=0 for all breakpoints
- [x] 2.2 Add test: second panel is placed beside the first when grid has horizontal room (lg breakpoint: x=4, y=0)
- [x] 2.3 Add test: third panel wraps to a new row when the row is full (e.g. three 4-wide panels on 12-col grid: panel 3 at x=8 or wraps)
- [x] 2.4 Add test: panel fills an interior gap left by a removed panel
- [x] 2.5 Add test: xs breakpoint places one 2-wide item per 2-col row (sequential rows)
- [x] 2.6 Update existing `createFallbackDashboardLayout` test to reflect new expected positions (lg[0] already passes; verify lg[1] is now x=4 not x=0)

## 3. Verification

- [x] 3.1 Run `npm test -- --testPathPattern=dashboardLayout` and confirm all tests pass
- [x] 3.2 Run `npm run lint` and confirm zero warnings
