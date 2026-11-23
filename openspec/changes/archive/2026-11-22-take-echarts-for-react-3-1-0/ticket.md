# HEL-1824: Take echarts-for-react 3.1.0: move the two `esm/core` imports to an exported subpath (#1221)

## Description

origin_kind: followup
origin_ticket: HEL-1820. The owner chose to file this.

Dependabot PR #1221 bumps echarts-for-react from 3.0.6 to 3.1.0, and HEL-1820 left it open. Version 3.1.0 adds a
package `exports` map without `./esm/*`. Helio imports `echarts-for-react/esm/core` in two places:

* `frontend/src/features/panels/ui/ChartPanel.tsx:8`
* `frontend/src/features/adminUsage/ui/UsageChart.tsx:5`

So tsc fails with TS2307 and the e2e legs fail.

## Do

* Change both imports to a subpath 3.1.0 exports. `echarts-for-react/lib/core` is the likely one; check the package's
  `exports` map.
* Keep tree-shaking: the core entry with the explicit echarts modules registration. Check the production bundle size
  of the chart chunk before and after.
* Take the bump, by rebasing #1221 or as part of this PR.
* Check chart panels in both themes, the admin usage chart, and `e2e/hel1573-motion-grid-chart.spec.ts`. HEL-1814
  changed that spec to read the configured animation option, so confirm the option path is unchanged.

## Acceptance criteria

- [ ] tsc, jest and the e2e legs are green on 3.1.0.
- [ ] The chart chunk size is stated before and after, with no large regression.

## Driver additions (claims verified at premise validation, see premise-validation.md)

- Take the bump in this PR (package.json + lockfile via `npm install echarts-for-react@3.1.0` in `frontend/`); after
  merge, close Dependabot #1221 with a comment linking this PR. Never push to Dependabot's branch.
- Beyond the two source imports, `frontend/jest.config.cjs`'s moduleNameMapper and ~35 test files' `jest.mock(...)`
  calls key on `echarts-for-react/esm/core`; they move with the imports.
- The prod-build probes (`@prod-build`, HEL-1816) must still pass.
