## Why

Chart axis labels, axis names and legend text take their colour from the panel's `appearance.color`, which defaults to
the literal `"inherit"`. `buildChartOption` passes that string straight into ECharts. ECharts only resolves `"inherit"`
when the element supplies an inherit colour, and axis labels and the legend never do. The canvas therefore never receives a
theme colour, and the HEL-1178 evaluator saw low-contrast labels in dark theme. The default is `"inherit"` on every
create path, so almost every chart panel is affected. HEL-1178 did not cause this; it was already present.

## What Changes

- When a panel's `appearance.color` is `"inherit"`, absent or empty, the chart's text resolves to the text colour that
  the panel card's own body text uses. This covers axis tick labels, axis names, legend text, the global `textStyle`
  and pie slice labels where they inherit the global colour. On an untinted panel that colour is the live
  `--app-text` token. On a tinted panel background it still equals the card's text colour (the card's
  contrast flip, `resolvePanelTextColor`, is applied defensively and does not currently trigger for an inherited
  colour), so chart text and card text always agree.
- An explicitly set panel colour (a real colour value) passes through unchanged, as it does today.
- The fix applies to every chart kind `buildChartOption` renders: line, bar, scatter and pie.
- Contrast is measured against WCAG 2.x SC 1.4.3 AA (4.5:1, normal-size text), in both themes, before and after, for all
  four kinds. The measurements are recorded as committed evidence in `docs/contrast-audit.md`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `echarts-chart-panel`: adds a requirement that chart text with an inherited panel colour resolves to the panel's
  theme-resolved text colour.

## Impact

- `frontend/src/features/panels/ui/buildChartOption.ts`, `useChartOption.ts` (pass the active theme through), and
  possibly a small exported helper in `frontend/src/theme/appearance.ts`.
- Unit tests next to `buildChartOption`; `docs/contrast-audit.md` (measurement section).
- No backend, schema or migration change. Stored appearance is never written.

## Non-goals

- Correcting an explicitly chosen low-contrast panel colour in the chart. The card body already corrects it, but the AC
  says an explicit colour wins. This is noted as a possible follow-up.
- `UsageChart` (admin) and other ECharts consumers that do not go through `buildChartOption`.
- Changing `--app-text` / `--app-text-muted` values or adding tokens.
