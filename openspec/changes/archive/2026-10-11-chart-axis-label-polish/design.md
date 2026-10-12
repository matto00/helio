## Context

See proposal.md (Why). Line references are against main 559c4be77 (after HEL-1306 #939 and HEL-1305 #959).

- `buildHeatmapDataOption` / `buildHistogramDataOption` (`frontend/src/features/panels/ui/heatmapHistogramOptions.ts`
  :39-93, :134-152) emit `xAxis: {type: "category", data}` (heatmap also `yAxis` category) with no `axisLabel`, so
  ECharts' `interval: "auto"` thins labels using a conservative width estimate.
- `buildChartOption` (`frontend/src/features/panels/ui/buildChartOption.ts`) REBUILDS `xAxis.axisLabel` from the
  appearance option only (:209-215) and `mergeHeatmapYAxis` (:171-190 of the options file) rebuilds the heatmap's
  `yAxis.axisLabel` from appearance styling only. The compact path (:363-381) spreads the built `axisLabel` forward.
  Any `axisLabel` put on the DATA option is therefore silently dropped today.
- HEL-1305 adds `hideOverlap: true` to the x `axisLabel` when `timeInstants` (time axis) is set (:212-214).
- Bin labels: `histogramBinLabel` (:125-130) formats each edge with `formatChartNumber` (`utils/chartAppearance.ts`
  :126-136, `maximumFractionDigits: 2`, no minimum) so precision varies per edge, and bins narrower than 0.005 can
  produce identical labels.
- ECharts is `6.1.0` (`frontend/package-lock.json` :6200-6202; `frontend/package.json` declares `^6.1.0`).

## Goals / Non-Goals

**Goals:** HEL-1487 items 2-5 and the bin-label precision of item 1, each proven by a test that was red before the
fix (precision, hint, e2e timing) or by a zero-hit/grep check (comments, version note). Axis-label thinning is not a goal (HEL-1512).

**Non-Goals:** any axis change for line/bar/pie/scatter; label rotation/ellipsis; changing `formatChartNumber`
(shared by every chart and tooltip); binning maths; colour/token changes.

## Decisions

### D1 — Axis-label thinning: unchanged (owner ruling)

Heatmap and histogram axis-label thinning stays exactly as on main; "show every label that fits" is split to
HEL-1512. `interval: 0` + `hideOverlap` was tried and rejected: ECharts sizes label collision boxes from the glyph
'国', which collapses to ~0.6em without a CJK font (heatmap row labels stacked at 375); an explicit `lineHeight`
fixed that, but packed bin labels sat ~6-7px apart and ran together, and the `textMargin` that separated them
re-thinned labels that fit. See evaluation-4 and the skeptic-final reports. Nothing in `buildChartOption.ts` changes.

### D2 — Bin labels: one decimal count per histogram

New pure helper in `heatmapHistogramOptions.ts`, e.g. `histogramBinLabels(bins): string[]`, used by
`buildHistogramDataOption` in place of per-bin `histogramBinLabel`:

- A SINGLE bin keeps today's label exactly (branch on `bins.length === 1`, NOT on zero width: a stored `binCount: 1`
  yields one bin with start != end, labelled "a to b" as today via `formatChartNumber`) — no
  precision rule applies (skeptic-design-3 item 1: a magnitude tolerance rounded 1700000000.5 to "1700000001").
- Multi-bin: `width = (last.end - first.start) / bins.length` (NOT `bins[0].end - bins[0].start`, which can compute 0
  when the data spans a few floating-point steps — skeptic-design-3 item 2). If that `width <= 0` (degenerate
  data), use `d = 20` and stop. Otherwise `cap = clamp(1 - floor(log10(width)), 0, 20)` (20 = `Intl.NumberFormat`'s safe `maximumFractionDigits` ceiling; a 6 cap made 0-0.000001/4 bins read
  "0.000000 to 0.000000" for adjacent bins — skeptic-design-1 item 2).
- `d` = the smallest integer in `0..cap` at which every edge `e` satisfies `|round(e * 10^d) / 10^d - e| <= tol`,
  where `tol = width * 1e-6` for `width > 0` (WIDTH-relative, not magnitude-relative: a magnitude-relative tolerance
  let 1700000000-1700000002/8 bins pass at d=0 with duplicate labels — skeptic-design-2 item 1) and
  no other tolerance (the single bin never reaches this rule); if none, `d = cap`.
- Distinctness argument: at any `d < cap` that passes, each rounded edge is within `1e-6 * width` of the true edge,
  so adjacent rounded edges differ by about `width` and their labels differ; at `d = cap` the rounding step
  `10^-cap <= width / 10` likewise keeps them apart. Guaranteed when `width >= 1e-19` (where `cap` is not clamped) and
  `width >= 1e-13 * max|edge|` (so edges are distinct doubles); outside that the spec makes no distinctness promise.
- Before formatting, each edge is rounded to `d` places and negative zero is normalised to `0` (`x === 0 ? 0 : x`,
  or `+ 0`): floating-point edges such as `-1.39e-17` (values -0.1 to 0.5 in 6 bins) otherwise render "-0.0"
  (skeptic-design-1 item 1).
- Format every edge with one `Intl.NumberFormat(undefined, {minimumFractionDigits: d, maximumFractionDigits: d,
  useGrouping: false})` (same locale and grouping as `formatChartNumber`). Label shape unchanged: `"a to b"`, or the
  single value when `start === end`.
- Worked: 0-10/4 bins -> d=1 ("0.0 to 2.5"...); 0-10/5 -> d=0; 0-10/3 -> cap 1 ("3.3 to 6.7"); 0-0.01/3 -> cap 4,
  distinct labels. `cap` is one place past the width's first significant decimal, so adjacent edges (one width
  apart) always differ at `d` -> no two adjacent labels are identical.
- The existing exported `histogramBinLabel` is kept only if still referenced elsewhere (grep); otherwise removed with
  its tests updated — no dead export.
- Alternative: change `formatChartNumber` — rejected, shared by every chart's ticks and tooltips.

### D3 — Heatmap hint copy

`OutputKindFields.tsx:155` becomes: "Aggregation isn't available for heatmap — rows with the same column and row
are summed into one cell." (same lead-in and em dash as the scatter/histogram hints). The test at
`OutputEditorSheet.heatmapHistogram.test.tsx:142` is updated to the new copy (red first: change the test, see it
fail, then the copy). HEL-1464 also edits that test file (Bin count name) — a textual conflict at most.

### D4 — Comments

- `ChartPanel.tsx:7`: stop enumerating a closed list; say the registered set is whatever `echartsCore.ts` registers
  for `ChartType` (and name heatmap/histogram's extra components, e.g. visualMap, only if true per `echartsCore.ts`).
- `chartOverlayOption.ts:71-72` (the ticket's ":24", moved by HEL-1305): "Ignored ... for pie/scatter" becomes "for
  any chart type other than line/bar (pie, scatter, heatmap, histogram)", matching the guard at :84.
- Grep `frontend/src/features/panels/ui` for other comments enumerating chart types as a closed set; list any in the
  report; fix only ones that are false today in the two chart option files above.

### D5 — e2e touch-target timing (item 4)

In `e2e/hel1311-heatmap-histogram-charts.spec.ts` (:482-504), before each `boundingBox()` read, wait for the editor
sheet's open animation to finish. The sheet is the shared `Modal`, whose CSS ANIMATION `ui-modal-in` scales it from
0.985 (`Modal.css` :19, :30; 44 x 0.985 = 43.34, the measured HEL-1311 value). `e2e/support/settleTransitions.ts`
waits for CSS TRANSITIONS only and would return immediately — do NOT use it. Wait on the `<dialog>`'s OWN
animations only, filtered to `ui-modal-in` — e.g. `evaluate(el => Promise.all(el.getAnimations().filter(a =>
(a as CSSAnimation).animationName === "ui-modal-in").map(a => a.finished)))` — re-run after each sheet open; or a
wait until the measured control's bounding box is identical across two animation frames (the pattern inside
`touchTargetProbe.ts`). NEVER `getAnimations({subtree: true})`: the lazily loaded chart preview's loading skeleton
runs an infinite shimmer (`Skeleton.css:16`, `ChartRenderer.tsx:18/:93`), whose `finished` never resolves
(skeptic-design-2 item 2). If the filtered list is empty because the animation already ended, that is a valid
settled state, not an error. Each `finished` promise is `.catch`-ed (a cancelled animation rejects) and the
`evaluate` returns `undefined`. Restore `toBeGreaterThanOrEqual(43.5)` at both sites.
Two MANDATORY proofs, each a recorded transcript: (a) with the settle wait temporarily removed and 43.5 in place, the
spec goes red at 375 (~43.34) — proving the wait is what makes it pass; (b) with the wait in place, a real heatmap
combobox and the bin-count input undersized in source CSS (e.g. min-height 40px) go red. Revert both, record green.

### D6 — Legend probe version comment (item 5)

A comment above the `_componentsViews` read (~:299-306) naming ECharts 6.1.0 (lockfile) and the internals read
(`_componentsViews`, the `visualMap.continuous` view's `_shapes.inRange`), and that an ECharts upgrade must re-check
it.

## Risks / Trade-offs

- [hideOverlap drops labels irregularly on narrow screens] -> acceptable: no overlap is the requirement; the 375 view
  is verified visually in both themes.
- [Heatmap y labels long enough to eat grid width under containLabel] -> unchanged by this change (interval only).
- [HEL-1464 merges first and conflicts in the e2e spec / test file] -> re-sync with origin/main before PR; resolve
  keeping both (its accessible-name rename, our 43.5 + settle).
- [Shared dev DB / browser] -> e2e and manual probes run as a throwaway `@example.test` user per agent.

## Planner Notes

- Self-approved: hint copy wording (D3); `interval: 0` + `hideOverlap` over rotation (D1); precision rule (D2).
- ECharts cannot parse `color-mix()`; no colour changes are planned — if any arise, use hex-resolvable tokens.
