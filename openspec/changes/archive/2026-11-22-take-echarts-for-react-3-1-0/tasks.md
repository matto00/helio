## Standing Constraints

## 1. Frontend

- [x] 1.1 On the base, run `npm run build` in `frontend/` and record chart chunk raw/gzip sizes (before) in chunk-sizes.md
- [x] 1.2 `npm install echarts-for-react@3.1.0` in `frontend/` (nice -n 19); confirm only frontend package.json/lockfile change
- [x] 1.3 Run `npm run typecheck`; save the TS2307 output as red-tsc-3.1.0.txt in the change dir and commit it
- [x] 1.4 Change `ChartPanel.tsx` and `UsageChart.tsx` imports to `echarts-for-react/lib/core`; update their comments
- [x] 1.5 Move `jest.config.cjs` moduleNameMapper key and every `jest.mock("echarts-for-react/esm/core")` to `lib/core`
- [x] 1.6 Update the `/esm/core` wording in `src/test/echartsForReactCoreMock.tsx` and `echartsCoreSubpathMock.ts`
- [x] 1.7 Confirm zero remaining `esm/core` references (grep `esm/core`, incl. comment-only sites) under `frontend/src`, `frontend/*.cjs`, `e2e/`

## 2. Tests

- [x] 2.1 `npm run typecheck`, `npm run lint`, `npm run format:check` green
- [x] 2.2 Jest for chart components and the full frontend suite green (3 workers)
- [x] 2.3 Mutation: break the moduleNameMapper target, show a test relying on the GLOBAL mapper (no local jest.mock) goes red, restore
- [x] 2.4 `npm run build` after; record chart chunk raw/gzip (after) in chunk-sizes.md; confirm full echarts not bundled
- [x] 2.5 Confirm the motion spec's animation-option path is unchanged in 3.1.0; run `e2e/hel1573-motion-grid-chart.spec.ts`
- [x] 2.6 Run the `@prod-build` leg from the repo root (`npm run e2e:prod-build`, DEV_PORT=7256 BACKEND_PORT=10163 explicit) green
- [x] 2.7 UI check on port 7256: a chart panel in light and dark, and the admin usage chart; performed by the evaluator (evaluation-1.md Phase 3), evidence: /home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/{eval-chart-dark,eval-chart-light,eval-admin-usage-chart-light,eval-admin-usage-chart-dark}.png
