## Why

Chart tooltips still show unformatted values and no axis-trigger comparison across series; hover has no styled emphasis. Prior polish work (F-025/F-196) already themed the tooltip's box (background/border/text/formatter) — the remaining gap is shadow/radius, mono-font values, multi-series axis comparison, and subtle, reduced-motion-aware hover emphasis (see `premise-validation.md`).

## What Changes

- Extend `resolveChartTheme()`/`ChartThemeTokens` with shadow (`--app-shadow-soft`) and radius (`--app-radius-md`) tokens; apply them to `tooltip` via `extraCssText` (ECharts tooltip DOM styling is CSS-text, not canvas props).
- Switch the tooltip's value `textStyle` to `fontMono` (axis labels already are; only the tooltip value text is wrong-fonted).
- Add a per-`chartType` tooltip `trigger`: `"axis"` with an `axisPointer`, applied only when a bar/line chart has more than one series (shared-x, multi-series comparison — matches this ticket's stated AC exactly; single-series bar/line and pie/scatter keep `"item"`, unchanged).
- Add subtle `series[].emphasis` (highlight/point-enlarge) styling in `appearanceToEChartsOption` (not `chartTypeOptions.ts`), animation-gated behind a live `prefers-reduced-motion` read (`window.matchMedia`, mirroring `resolveChartTheme`'s live-DOM-read pattern) since ECharts emphasis motion is JS config, not CSS, and the existing `motionTokenGuard.css.test.ts` only scans `.css` files.
- Add `accentColor` (from `useTheme()`) to `ChartPanel`'s option-building `useMemo` dependency array, since hover emphasis uses `--app-accent-strong` (DESIGN.md's documented `(hover)` token) and must re-resolve after an accent-only change (no theme toggle).
- Reuse the existing `formatChartNumber` for tooltip values — no new unit/label-format system (none exists in `ChartAppearance` today).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `echarts-chart-panel`: adds themed tooltip shadow/radius/mono-value-font, axis-trigger multi-series tooltip comparison for bar/line, and subtle reduced-motion-aware hover emphasis.

## Impact

- `frontend/src/utils/chartAppearance.ts` (`ChartThemeTokens`, `resolveChartTheme`, `appearanceToEChartsOption`).
- `frontend/src/utils/chartTypeOptions.ts` (per-chart-type emphasis, if kept out of the base option builder).
- `frontend/src/features/panels/ui/ChartPanel.tsx` (accent dependency in the option `useMemo`).
- No backend/API/schema changes. No migration.
