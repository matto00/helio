# HEL-566: Richer chart tooltips + hover states

## Description

Charts render via ECharts (`echarts-for-react`) in `features/panels/ui/ChartPanel.tsx`, with options built in `utils/chartAppearance.ts` / `utils/chartTypeOptions.ts`. Tooltips currently use ECharts defaults, which don't match Helio's tokens (surface, border, mono numerals) and give minimal information. Hover feedback on series/points is unstyled. This ticket makes tooltips and hover states first-class and on-brand.

**Premise-check scope-down (see `premise-validation.md`, verdict: minor-staleness):** F-025/F-196/F-195 polish work already landed most of the "themed box" half of this ticket (backgroundColor/borderColor/borderWidth/base textStyle/valueFormatter, and the one-helper `resolveChartTheme()`). The remaining, genuinely-missing scope is: tooltip shadow/radius, mono-font tooltip VALUES (axis labels already mono), an axis-trigger tooltip for shared-x multi-series charts, hover emphasis styling (nothing exists today) honoring `prefers-reduced-motion`, and (conditionally) adding `accentColor` to `ChartPanel`'s option-memo dependencies if hover emphasis is accent-colored. There is no separate chart unit/label-format system to build — "respecting the panel's existing label/unit/number formatting" means continuing to use the existing `formatChartNumber`.

## Scope

* Configure a themed ECharts `tooltip` in the option builder: opaque `--app-surface-strong` background, `--app-border-subtle` hairline, `--app-shadow-soft`, `--app-text`/`--app-text-muted` text, mono tabular numerals for values (`--font-mono`), `--app-radius-md`. Because ECharts tooltip styling is config-not-CSS, read the token values at render (via the resolved theme, mirroring how `ChartPanel` already consumes `useTheme`) and pass them into the option — keep the mapping in one helper.
* Show useful content: series name, category/x value, formatted y value (respecting the panel's label/unit/number formatting already used in appearance), and multi-series comparison on shared-x charts (axis-trigger tooltip listing all series at that x).
* Style hover emphasis (series highlight / point enlarge) consistently; keep it subtle per §3 (no gratuitous motion) and honor `prefers-reduced-motion`.
* Re-resolve tooltip/hover colors when the theme or accent changes so it stays correct after a live theme toggle.

## Acceptance criteria

* Tooltips render with Helio surface/border/shadow/text tokens and mono values; multi-series charts show an axis tooltip comparing series at the hovered x.
* Values honor the panel's existing label/unit/number formatting.
* Tooltip/hover styling updates correctly after a light/dark toggle and accent change without remount glitches.
* Hover emphasis is subtle and respects `prefers-reduced-motion`. Unit tests for the tooltip-option/formatter helper; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* Click/drill-down behavior (drill-down ticket) and cross-filtering (cross-filter ticket).
* Non-chart panel types.

## Dependencies

None. Shares the ECharts option-builder surface with the drill-down and cross-filter tickets. Must not block ECharts click-event handling (HEL-572 drill-down, next in queue).
