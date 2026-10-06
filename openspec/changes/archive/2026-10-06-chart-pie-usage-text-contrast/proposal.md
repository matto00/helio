## Why

HEL-1263 resolved chart axis and legend text to the theme's `--app-text` token, but left two chart text surfaces on ECharts' own built-in colours: pie slice labels (ECharts' default dark label with a light outline, unreadable on the dark surface without the outline and visually heavier than the themed legend) and the owner admin usage page's `UsageChart`, which builds its own option and sets no text colour at all on axis labels or legend. Both violate DESIGN.md's "no untokened colour" rule and may fail WCAG 2.x SC 1.4.3 AA in one theme.

## What Changes

- Pie slice labels on dashboard chart panels take the chart's resolved text colour (`resolveChartTextColor`: the live `--app-text` token for an inherited panel colour, an explicit panel colour unchanged), with ECharts' default light outline removed. Label position (outside the slices) is unchanged.
- The admin usage page's charts resolve their axis labels, axis names, legend text and global text style through `resolveChartTextColor` and the live `--app-text` token, in both themes.
- Before/after contrast is measured on the running app in both themes and recorded by extending `docs/contrast-audit.md` §10.
- Unit tests over the option builders that are red on main.

## Capabilities

### New Capabilities

### Modified Capabilities
- `echarts-chart-panel`: pie slice labels join axis/legend text in resolving to the panel's theme text colour.
- `owner-usage-admin`: the usage page's charts render text in the theme text token.

## Impact

Frontend only: `frontend/src/features/panels/ui/buildChartOption.ts` (and/or `frontend/src/utils/chartTypeOptions.ts` pie handling), `frontend/src/features/adminUsage/ui/UsageChart.tsx`, their tests, `docs/contrast-audit.md`. No API, schema, backend or dependency change.
