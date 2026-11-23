## Context

`ChartPanel.tsx:8` and `UsageChart.tsx:5` import `ReactECharts` from `echarts-for-react/esm/core` (F-022): the core
component takes our own `echarts` instance from `echartsCore.ts`, which registers only the chart types and components
helio uses, instead of the package root, which hard-imports all of `echarts`. 3.0.6 has no `exports` map, so the deep
path resolved. 3.1.0's map (`npm view echarts-for-react@3.1.0 exports`) exposes only `.`, `./lib`, `./lib/*` and
`./lib/*.js`; each entry has `types` -> `lib/*.d.ts`, `module` -> `esm/*.js`, `default` -> `lib/*.js`.

Frontend resolution: `tsconfig.json` uses `moduleResolution: "Bundler"` (honors `exports`), Vite 8 (default resolve
conditions include `module`), Jest via ts-jest with `moduleNameMapper` keyed on `^echarts-for-react/esm/core$` and ~35
test files calling `jest.mock("echarts-for-react/esm/core", ...)`.

## Goals / Non-Goals

Goals: 3.1.0 installed; tsc, jest, e2e and `@prod-build` green; the chart chunk keeps tree-shaking (no large size
regression), measured before and after.

Non-goals: any chart behavior, option, theme or animation change; any change to `echartsCore.ts`'s registered set.

## Decisions

1. **Specifier: `echarts-for-react/lib/core`.** It is the only exported path to the core component. Under Vite the
   `module` condition maps it to `esm/core.js`, the same file the old import loaded, so the bundle should be
   byte-comparable. This is a claim to verify, not assume: the executor confirms from the built chunk (size, and that
   the full `echarts` package is not pulled in) rather than from the map alone. If Vite were to pick `default`
   (`lib/core.js`, CommonJS), the chunk would change; that would show in the measurement and must be explained or fixed
   (e.g. adding `module` to `resolve.conditions` is NOT pre-approved — escalate first).
   Alternative rejected: importing the package root `echarts-for-react` (defeats tree-shaking, F-022).
   Alternative rejected: a Vite/TS alias to `esm/core` (bypasses the package's public contract; would break again).
2. **Tests: move every mock specifier to the new path.** A `jest.mock("echarts-for-react/esm/core")` that no longer
   matches the import is silent: the module under test would load the real (CommonJS) `lib/core` and tests asserting on
   `data-option` would fail, or worse, pass vacuously. The `moduleNameMapper` key moves to `^echarts-for-react/lib/core$`.
   Proof the mocks still apply: a temporary mutation (break the global mapper target) must turn a dependent test red.
3. **Red first.** Before editing imports, install 3.1.0 and record `npm run typecheck` output (TS2307 at both sites) as
   `red-tsc-3.1.0.txt` in the change dir, committed.
4. **Bump in this PR**, via `npm install echarts-for-react@3.1.0` in `frontend/` (only `frontend/package.json` and
   `frontend/package-lock.json` should change; the root lockfile is checked and left alone unless it pins the frontend
   dep). Dependabot's #1221 is closed after merge, never pushed to.
5. **Chunk measurement.** `npm run build` in `frontend/` on the base (3.0.6, old import) and on the branch; record each
   chart-related chunk's raw and gzip size from Vite's output in `chunk-sizes.md` in the change dir. "No large
   regression" threshold: more than 5% gzip growth on the chart chunk is escalated, not explained away.
6. **Option path for the motion spec.** `e2e/hel1573-motion-grid-chart.spec.ts` reads the configured animation option
   (HEL-1814). Confirm by reading the spec and 3.1.0's `lib/core` component that the instance/option access it relies
   on is unchanged, then run the spec.
7. **Comments.** Update comments naming `/esm/core` (ChartPanel, UsageChart, the two mocks, jest.config.cjs) to the new
   specifier; keep wording otherwise. Note in the mock docblock that `lib/core` resolves to CommonJS under Jest, so the
   mapper is no longer needed for ESM parsing but still provides the stand-in.

## Risks / Trade-offs

- Vite condition choice (Decision 1) — mitigated by measurement.
- 3.1.0 behavior changes in the component itself (e.g. option diffing) — mitigated by jest, the motion spec, the
  `@prod-build` leg and a UI check of chart panels in light and dark plus the admin usage chart.
- Sibling lane HEL-1615 may touch ChartPanel: only the import line and its comment change here; merge main as needed.

## Planner Notes

- Self-approved: skip_specs (no behavior change); `lib/core` specifier; moving test mocks along (ticket understated the
  site count — premise validation, minor staleness).
- UI checks run against this lane's dev port 7256 / backend 10163, lane DB `helio_hel1824`, backend with
  `ANTHROPIC_API_KEY` exported empty.
