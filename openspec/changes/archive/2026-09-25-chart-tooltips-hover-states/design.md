## Context

See `proposal.md` for motivation and `premise-validation.md` for the full audit trail. Summary of
what already exists vs. what's genuinely missing (file:line evidence):

**Already done (do not touch unless a decision below requires it):**
- Tooltip `backgroundColor`/`borderColor`/`borderWidth`/base `textStyle`/`valueFormatter`
  (`frontend/src/utils/chartAppearance.ts:105-112`, F-025).
- The single theme-token helper, `resolveChartTheme()` (`chartAppearance.ts:44-55`), reading
  `--app-surface-strong`/`--app-border-subtle`/`--app-text`/`--font-sans`/`--font-mono` live off
  `getComputedStyle(document.documentElement)`.
- Axis-label mono font (`chartAppearance.ts:121,131`).
- Light/dark re-resolution without remount: `ChartPanel.tsx`'s option `useMemo` already depends on
  `theme` (from `useTheme()`) and re-calls `resolveChartTheme()` on every recompute
  (`ChartPanel.tsx:272-281,428-438`), with `notMerge={true}` on one mounted `ReactECharts` instance.
- `formatChartNumber` (`chartAppearance.ts:61-71`) is the only chart number-formatting convention;
  there is no separate chart unit/label-format system in `ChartAppearance` (`panel.ts:43-49`).

**Genuinely missing:**
- Tooltip shadow/radius (tokens exist in `theme.css:60,224,294`; not read or applied).
- Tooltip value font is `fontSans`, not `fontMono` (`chartAppearance.ts:110`).
- No `trigger`/`axisPointer` config anywhere (zero grep hits) — every chart is item-trigger today.
- No `emphasis`/hover-styling config anywhere (zero grep hits).
- `ChartPanel`'s option `useMemo` does not depend on `accentColor` (`ChartPanel.tsx:272`, only
  `theme` destructured), needed once hover emphasis uses an accent-derived color.

## Goals / Non-Goals

**Goals:**
- Close exactly the five gaps above; touch nothing already working.
- Keep the tooltip token mapping inside the existing single helper (`resolveChartTheme`/
  `ChartThemeTokens`) rather than a second, parallel one.
- Keep hover emphasis subtle and inert when `prefers-reduced-motion: reduce`.

**Non-Goals:**
- Click/drill-down (HEL-572) and cross-filter (HEL-588) — this change must not add any ECharts
  event-handler wiring that would collide with those tickets' own `on('click', ...)` additions.
- A new per-panel unit/label-format system — none exists today; not introducing one here
  (see premise-validation.md).
- Re-theming anything already covered by F-025/F-196.

## Decisions

**D1 — Shadow/radius via `tooltip.extraCssText`, not new canvas-style props.** ECharts tooltip
content is a real DOM element positioned over the canvas, styled through `backgroundColor`/
`borderColor`/`borderWidth` (already set) plus a free-form `extraCssText` string for anything those
typed props don't cover (box-shadow, border-radius). Extend `ChartThemeTokens` with `shadowSoft:
string` and `radiusMd: string`, read via `resolveChartTheme()` exactly like the existing five
tokens, and set `tooltip.extraCssText: `box-shadow: ${shadowSoft}; border-radius: ${radiusMd};``.
Alternative considered: a bespoke tooltip DOM template (`tooltip.formatter` returning HTML) — more
surface area for the same result; rejected, `extraCssText` is additive to the existing config-only
approach.

**D2 — Tooltip value font: `themeTokens.fontMono` on `tooltip.textStyle`.** One-line change to the
existing `textStyle` object (`chartAppearance.ts:110`); mirrors the axis-label convention already in
place. No alternative considered — this is a straight bug-parity fix.

**D3 — Axis-trigger tooltip: `trigger: "axis"` for bar/line WITH MORE THAN ONE SERIES, unchanged
`"item"` for pie/scatter and for single-series bar/line, chosen per `chartType` (and series count)
inside `appearanceToEChartsOption`.** (Revised after design-gate skeptic round 1 CR1 — resolution
(a): restrict to `series.length > 1`, matching the ticket's stated AC and the spec delta's
Requirement 2 exactly as written, rather than silently widening scope to every bar/line chart.)
`axisPointer.type: "shadow"` for bar (ECharts convention: a shaded column under the cursor),
`"line"` for line (a vertical guide line) — applied only when the built option's series array has
more than one entry. Pie has no axis; scatter's x/y are both continuous value axes with no natural
"category" tooltip comparison, so both keep item-trigger. A single-series bar/line chart keeps
item-trigger unchanged — no behavior change for the common single-series case, matching the ticket's
literal "multi-series comparison on shared-x charts" framing. `appearanceToEChartsOption` needs the
already-assembled series count at the point it sets `tooltip` — `ChartPanel.tsx` builds
`dataOption`/`series` before calling `appearanceToEChartsOption`, so either (i) `ChartPanel.tsx`
passes the series count in as an argument, or (ii) the axis-trigger fields are set as a later merge
pass in `ChartPanel.tsx` itself (after `dataOption`/`appearanceOption` are both known), mirroring how
`applyChartTypeOptions` is already applied as a distinct post-merge pass (`ChartPanel.tsx:372`).
Executor's call — (ii) fits the existing post-merge-pass pattern most closely; note the choice in the
PR body.

**D4 — Hover emphasis: `series[].emphasis` set in `appearanceToEChartsOption`, gated on a live
`prefers-reduced-motion` read.** Add a small `read the media query at build time`
(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`, guarded for the same
`typeof document === "undefined"` SSR/Jest case `resolveChartTheme` already guards) helper
alongside `resolveChartTheme`. When reduced motion is requested, set `animation: false` on the
emphasis-relevant series options (ECharts' own escape hatch — an instant state change, no
transition) instead of omitting emphasis outright: the requirement is "no animated transition," not
"no emphasis." `focus: "series"` + a subtly bumped `itemStyle.borderWidth`/`lineStyle.width` (kept
inside §3's "no gratuitous motion" — no scale/bounce, no color change beyond what emphasis already
implies) is the concrete shape; exact px deltas are an implementation, not design, decision.
Rejected: CSS-only hover (canvas rendering means there is no DOM node per point to attach `:hover`
to — this must be ECharts JS config, confirmed by `motionTokenGuard.css.test.ts` scanning only
`.css` files and thus never covering this).

**D5 — Emphasis color: `--app-accent-strong` (the documented hover token), add `accentColor` to
`ChartPanel`'s `useMemo` deps.** (Revised after design-gate skeptic round 1 CR2: `DESIGN.md`'s own
color-purpose table (§3) names `--app-accent-strong` as the `(hover)` token — the established,
~20-site convention for `:hover` states site-wide, e.g. `PanelGrid.css`, `auth.css`. Plain
`--app-accent` is not the documented hover row; using it without a stated reason would be an
unexamined deviation from that convention.) Extend `ChartThemeTokens` with `accentStrong: string`
reading `--app-accent-strong` (via the same `resolveChartTheme()` live-read pattern) for the
hover-emphasis highlight color, and add `accentColor` (from `useTheme()`) to `ChartPanel.tsx`'s
option `useMemo` dependency array (currently only `theme`, line 272) so an accent-only change (no
theme toggle) still triggers a re-resolve of the derived `--app-accent-strong` value — this is the
one real gap found in the "already re-resolves on theme toggle" premise-check finding.

## Gate-Chain Implications Checklist

Not applicable — this change touches no `.husky/**` file and no script a `.husky/pre-commit` hook
invokes (verified: the diff is confined to `frontend/src/utils/chartAppearance.ts`,
`frontend/src/utils/chartTypeOptions.ts`, `frontend/src/features/panels/ui/ChartPanel.tsx`, and
their tests).

## Risks / Trade-offs

- [Axis-trigger only fires for series.length > 1 (D3, revised) — a chart that starts single-series
  and later gains a series via a field-mapping edit changes tooltip behavior mid-session] → Expected
  and desired: the requirement is explicitly about multi-series comparison: verify visually that
  crossing that boundary doesn't glitch (no remount, no stale trigger mode) rather than that it never
  happens.
- [`extraCssText` is a raw string, easy to typo] → Build it from the same token variables already
  validated by `resolveChartTheme`'s existing tests; unit-test the built string directly.
- [Emphasis + future drill-down click handler interaction] → D4 adds no `on('click', ...)` handler
  and no `selectedMode`; HEL-572 is free to add its own click wiring on top without needing to touch
  this change's emphasis config.

## Migration Plan

None — frontend-only, no persisted data, no schema, no feature flag. Ships behind the existing
per-panel `chart.tooltip.enabled` toggle (unchanged).

## Planner Notes

Self-approved: capability delta filed against the existing `echarts-chart-panel` spec (modified,
not new) — tooltip/hover are already within that capability's remit (chart panel rendering). No
external dependency, no breaking change, no scope beyond the ticket — nothing here rises to a
Planning `ESCALATION`.
