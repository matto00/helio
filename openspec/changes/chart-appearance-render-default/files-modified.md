- `frontend/src/features/panels/ui/buildChartOption.ts` — absent appearance.chart falls back to defaultChartAppearance (render-time)
- `frontend/src/features/panels/ui/ChartPanel.defaultAppearance.test.tsx` — red-first tooltip test, absent-vs-explicit equality (light/dark), tooltip.enabled:false guard
Parity check (task 1.2): backend ChartAppearance.Default == frontend defaultChartAppearance (8 seriesColors, legend show/top, tooltip enabled, axisLabels x/y show+label "", chartType line).
