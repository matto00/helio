## Why

echarts-for-react 3.1.0 (Dependabot #1221) adds a package `exports` map with no `./esm/*` entry. Helio imports
`echarts-for-react/esm/core`, so the bump fails tsc (TS2307) and every e2e leg. The bump stays blocked until the import
moves to an exported subpath.

## What Changes

- Bump `echarts-for-react` to 3.1.0 in `frontend/package.json` and the lockfile.
- Change the two runtime imports (`ChartPanel.tsx`, `UsageChart.tsx`) from `echarts-for-react/esm/core` to the exported
  `echarts-for-react/lib/core` subpath, whose `module` condition maps to the same `esm/core.js` build.
- Move the Jest `moduleNameMapper` key and every test file's `jest.mock("echarts-for-react/esm/core", ...)` to the new
  specifier, so the mocks keep applying; update comments that name the old path.
- Keep tree-shaking: the core entry plus the explicit registration in `echartsCore.ts` is unchanged.
- Measure the production chart chunk before and after and state both.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. No behavior changes; `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- No chart behavior, option, theme or animation change.
- No change to `echartsCore.ts`'s registered module set or to `echarts` itself.
- No edit to Dependabot's branch; #1221 is closed after this PR merges.

## Impact

- `frontend/package.json`, `frontend/package-lock.json` (or root lockfile, whichever holds the frontend deps).
- `frontend/src/features/panels/ui/ChartPanel.tsx`, `frontend/src/features/adminUsage/ui/UsageChart.tsx`.
- `frontend/jest.config.cjs`, `frontend/src/test/echartsForReactCoreMock.tsx` and `echartsCoreSubpathMock.ts`
  (comments), ~35 `*.test.tsx` files' mock specifiers.
