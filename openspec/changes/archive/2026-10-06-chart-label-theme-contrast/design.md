## Context

See proposal.md (Why). Current state on main (835b57d93):

- `defaultPanelAppearance.color` is `"inherit"` (`frontend/src/theme/appearance.ts:11`). Every create path stores it.
- `buildChartOption.ts` sets `textColor = appearance?.color` and writes it verbatim into `xAxis/yAxis.axisLabel.color`,
  `nameTextStyle`, the global `textStyle`, and `legend.textStyle` (lines ~100-163), for pie and non-pie alike.
- ECharts 6.1.0: `AxisBuilder` uses `labelModel.getTextColor()` as the label `fill`. That call returns the string
  `"inherit"`, and `labelStyle.setTokenTextStyle` only maps `"inherit"` to `opt.inheritColor`, which axis labels and
  legend never pass. So no theme colour ever reaches the canvas. The actual painted colour has not been measured yet;
  task 1 measures it.
- The panel card body already resolves its own text colour with `resolvePanelTextColor(theme, background,
  transparency, color)` (`PanelCard.getPanelCardStyle` → `--panel-text-override`). For `"inherit"` that returns the
  theme's `defaultText`, which equals `--app-text` (`#f2efe9` dark / `#211d19` light). It flips to a readable
  light/dark literal when a tinted panel background would push `defaultText` below 4.5:1.
- `useChartOption` already has `theme` from `useTheme()` and live tokens from `resolveChartTheme()` (`themeTokens.text`
  is the live `--app-text`).

## Goals / Non-Goals

**Goals:** for an inherited colour, every piece of chart text resolves to a theme-correct colour that clears WCAG
2.x SC 1.4.3 AA (4.5:1, normal text — axis labels are ~12px, and compact mode is 10px, so the large-text 3:1 floor
never applies). That means axis tick labels, axis names, legend text, and pie slice labels where they fall back to the
global text colour. This holds for line, bar, scatter and pie, in light and dark. Chart text and card text agree.

**Non-Goals:** see proposal.md. Also out of scope: tooltip text, which is already `themeTokens.text`, and gridline
colours.

## Decisions

**D1 — "inherit" means "the panel's own text colour", not a new chart-specific token.** `appearance.color` is the
panel's Text colour, and `"inherit"` means "use what the panel text uses". The card resolves that to `--app-text`, so
the chart resolves to the same value. Alternatives considered:

- `--app-text-muted` for axes, for a quieter visual hierarchy. Rejected: it introduces a second resolution rule the card
  doesn't share, and muted is already tuned near the 4.5 floor (DESIGN.md / contrast-audit §3), so a tinted panel
  surface would push it under.
- Leaving the colour undefined so ECharts' own default applies. Rejected: that default is ECharts' built-in palette,
  not a DESIGN.md token, and DESIGN.md forbids untokened colour.

**D2 — The resolution rule, as one exported helper in `theme/appearance.ts`** (for example
`resolveChartTextColor(theme, appearance, liveTextToken)`):

1. A non-empty `appearance.color` other than `"inherit"` is an explicit colour. Return it unchanged (AC: "unless the
   panel explicitly sets a colour").
2. Otherwise compute `resolvePanelTextColor(theme, background ?? "transparent", transparency ?? 0, "inherit")`.
   - If that returns the theme's `defaultText` (no flip needed), return `liveTextToken`, the live `--app-text` from
     `resolveChartTheme()`, so the value tracks theme.css rather than the JS palette copy.
   - Otherwise return the flipped value, so the chart flips exactly when the card flips. This branch is defensive:
     measurement showed `resolvePanelTextColor` never flips for `"inherit"` at the 0.24 tint strength (12 probed
     backgrounds, both themes), so it is unreachable today and has no test of its own.

Keeping this in `appearance.ts`, next to `resolvePanelTextColor`, keeps one owner for the contrast-flip rule.
`buildChartOption` calls it once and uses the result everywhere it currently uses `textColor`. Alternative considered:
always return `resolvePanelTextColor`'s literal. Rejected because it would bypass the live token in the common case.

**D3 — Thread `theme` into `buildChartOption`.** Add a required `theme: Theme` field to `BuildChartOptionParams`.
`useChartOption` passes its existing `useTheme().theme`. Known one-frame skew: on a toggle, the render-time `theme` is
new while the DOM tokens are stale. The existing `themeSyncTick` rAF recompute already corrects this within one frame,
the same as for every other token today. No new effect.

**D4 — Pie.** Pie has no axes. Its text is the legend and the slice labels. The executor measures what colour pie slice
labels paint today (ECharts' pie label default may use the series colour rather than the global `textStyle`). If they
take the global text colour, D2's value covers them through `textStyle`. If they use the sector colour, they are outside
this ticket's "axis and legend text" scope, and this is recorded in evidence. Do not restyle series colours.

**D5 — Measurement is the arbiter, not inspection.** Before and after, in the RUNNING app (own ports 6695/9602, own
headless context, own throwaway user), for line, bar, scatter and pie, in light and dark:

- Record the painted label colour. Read the zrender text element's resolved `style.fill` through
  `echarts.getInstanceByDom(...).getZr()`, and also sample canvas pixels inside a label's bounding box. Use the glyph
  pixel that differs most from the background as the painted colour. This matters "before", where `fill` is the invalid
  string `"inherit"` and the canvas keeps whatever `fillStyle` it already had.
- Record the composited background behind the canvas, sampled from a background pixel.
- Compute the WCAG relative-luminance ratio, and record it in a new section of `docs/contrast-audit.md` (before → after
  table, threshold stated as SC 1.4.3 AA 4.5:1), plus screenshots in the change dir.
- Add one tinted-background panel (dark theme) to show chart text still equals the card text on a tint.

Every seeded row or user is recorded by exact id in the evidence, and deleted by those ids at the end.

**D6 — Regression guard is a unit test on the option, made red first.** The defect is the option value, so a jsdom test
over `buildChartOption` is the right seam:

- `"inherit"` / absent appearance / empty colour → `themeTokens.text`, on axisLabel, nameTextStyle, textStyle and
  legend.textStyle, for each of line, bar, scatter and pie (pie: textStyle and legend).
- An explicit hex passes through.
- A tinted background (`#ffd700`) with an inherited colour → still the token, equal to the card's text colour (the flip branch is unreachable, see D2).

This is red on main, and green after the change. A mutation that restores `appearance?.color` must turn it red. No new
committed e2e spec: the rendered measurement in D5 is evidence, not a CI gate. That avoids new CI load and shared-DB
seeding in CI.

## Risks / Trade-offs

- [Full-strength `--app-text` axis labels look heavier than before.] → Accepted. This is exactly the panel's text colour
  (D1). The visual check in both themes (D5 screenshots) is what the skeptic judges. A muted variant would be a separate
  design decision.
- [The card corrects an explicit low-contrast colour but the chart will not.] → Kept, as the AC requires. Noted as a
  follow-up candidate.
- [JS palette `defaultText` drifting from theme.css `--app-text` would break the D2 equality check.] → It is already
  lockstep-commented in `appearance.ts`. A unit assertion that palette `defaultText` equals the theme.css `--app-text`
  for both themes is added if no existing guard covers it.

## Planner Notes

- Self-approved: D1 token choice (`--app-text`, the panel's own text colour, not muted). This is not escalated, because
  "inherit" already has a defined meaning on the card and this decision makes the chart honour it. No new token, no
  token value change.
- No gate-chain (`.husky/**`) impact.
