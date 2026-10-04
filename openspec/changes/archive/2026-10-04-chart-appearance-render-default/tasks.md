## Standing Constraints

## 1. Frontend

- [x] 1.1 In `frontend/src/features/panels/ui/buildChartOption.ts`, replace the `appearance?.chart != null` branch with `appearanceToEChartsOption(appearance?.chart ?? defaultChartAppearance, themeTokens)`; verify `npm run typecheck` and `npm run lint` pass
- [x] 1.2 Compare backend `ChartAppearance.Default` (model.scala) with frontend `defaultChartAppearance` field by field and record the result in the commit body/evidence; verify no mismatch (stop and report on mismatch)

## 2. Tests

- [x] 2.1 Red-first test: single-series ChartPanel (no tooltip key at all today) with `appearance` lacking `chart` asserts themed tooltip (backgroundColor, extraCssText shadow/radius, mono fontFamily); verify it FAILS on the unmodified code (capture output) and passes after 1.1
- [x] 2.2 Equality test: option with `chart` absent deep-equals option with `chart: defaultChartAppearance`, under both light and dark theme tokens; verify it passes
- [x] 2.3 Guard test: stored `tooltip.enabled: false` still yields `tooltip.show === false`; verify by mutating the guard and seeing it fail
- [x] 2.4 Run the full frontend Jest suite plus `npm run lint`, `npm run typecheck`, `npm run format:check`; verify all green (known flake PanelCard.test.tsx:625 — rerun, don't fix)
