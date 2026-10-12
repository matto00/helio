## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 559c4be77d1915c03aec687d1d6d8ffcd42b3c9c. The change dir is untracked, so there is no code diff yet. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/chart-axis-label-polish/HEL-1487`.

### What I verified (with evidence)

**D1: a data-option `axisLabel` is dropped. CONFIRMED.**
- `buildChartOption.ts:209-215`: `xAxis.axisLabel` is rebuilt from `appearanceOption.xAxis.axisLabel` plus `color`, plus `hideOverlap` only when `timeInstants` is set. `dataOption.xAxis.axisLabel` is overwritten.
- `heatmapHistogramOptions.ts:171-190` (`mergeHeatmapYAxis`) returns `{...dataOption.yAxis, ...rest, axisLabel: labelStyle}`, so the data y `axisLabel` is also dropped. `buildChartOption.ts:220` then spreads `yAxisBase.axisLabel` forward.

**D1 placement is right.**
- Heatmap x and histogram x take the `:209-215` merge. Heatmap y takes the `:220` merge, and only the heatmap should get it there, because the histogram y is a value axis.
- The compact pass (`:363-384`) spreads `built.*Axis.axisLabel` and only adds `fontSize`, so the new keys survive it.
- No later pass rewrites axis labels for these types:
  - `applyChartTypeOptions` (`chartTypeOptions.ts:176-178`) handles line/bar/pie only.
  - `applyHeatmapTheme` touches only visualMap and grid.
  - The overlay is gated to line/bar (`chartOverlayOption.ts:84`).
  - `applyReferenceMarks` excludes heatmap (`referenceMarksOption.ts:84`) and on a histogram writes only the value-axis key (`:90`).
- `buildChartOption` has one production caller (`useChartOption.ts:96` via `ChartPanel.tsx:89`), so large views share the path.
- The History view draws no chart for these types (main spec, "Large and history views").

**ECharts 6.1.0 honours `hideOverlap` on a category axis with `interval: 0`: yes, per the source.**
- The installed `node_modules/echarts/package.json` reads `"version": "6.1.0"`.
- `lib/component/axis/AxisBuilder.js:262` reads `axisModel.get(['axisLabel','hideOverlap'])` with no axis-type gate.
- `layOutAxisTickLabel` (`:597-614`) calls `hideOverlap` on all non-ignored label layouts for any axis.
- `lib/label/labelLayoutHelper.js:389-433` greedily hides each label that intersects an already-displayed one.
- `interval: 0` only feeds the label set. D1 still keeps a rendered-chart proof requirement plus an escalate-if-not clause, which is the right belt-and-braces.

**D2 precision rule, worked numerically.** I simulated D2's exact rule with `Intl.NumberFormat`, using the `min + i*width` edges from `utils/histogramBins.ts`:

| Case | d / cap | Labels |
|---|---|---|
| 0–10 / 4 | d=1 | "0.0 to 2.5" … "7.5 to 10.0" (spec scenario OK) |
| 0–10 / 5 | d=0 | "0 to 2" … "8 to 10" (OK) |
| 0–10 / 3 | d=1 | "3.3 to 6.7" (OK) |
| 0–0.01 / 3 | d=4 | "0.0000 to 0.0033", "0.0033 to 0.0067", "0.0067 to 0.0100" (distinct, OK) |
| −10–0 / 4 and −7.5–2.5 / 4 | | Correct |
| **−0.1–0.5 / 6** | d=1 | **"-0.1 to -0.0", "-0.0 to 0.1"**. The edge `-0.1 + 0.1` is `-1.39e-17`; it passes D2's exactness tolerance at d=1, and Intl renders a negative value that rounds to zero as "-0.0". The same happens for −0.1–0.6/7, −0.1–0.7/8 and −0.2–0.5/7. |
| **0–0.000001 / 4** | cap clamped to 6 | **"0.000000 to 0.000000", "0.000000 to 0.000001", "0.000001 to 0.000001", "0.000001 to 0.000001"**. Labels are identical across adjacent bins and within one bin. |

- The tiny-range row falsifies both D2's claim ("adjacent edges always differ at d") and the spec delta's normative "Adjacent bins SHALL therefore never share an identical label". The `clamp(..., 0, 6)` breaks the "one place past the width's first significant decimal" guarantee whenever the width is below about 1e-5.
- Single-bin case (`start === end`, width 0, cap 6): it formats a single value with the fewest exact places. This matches the spec text, and the x `axisLabel` carries no formatter that would re-round it (`chartAppearance.ts:221`; only y has `formatter: formatChartNumber`, `:232`).

**D3/D4 citations hold.**
- `OutputKindFields.tsx:155` has the hint "it plots the rows as they are".
- `ChartPanel.tsx:7` reads "bar/line/pie/scatter only".
- `chartOverlayOption.ts:71-72` reads "for pie/scatter", with the guard at `:84`.
- `echartsCore.ts:35,43` register heatmap and visualMap.

**D5 settle approach: sound as specified, with one trap.**
- The sheet is the shared `Modal`, whose entrance is a keyframe animation: `Modal.css:19` has `animation: ui-modal-in var(--transition-slow) backwards`, and `:30` has `transform: translateY(6px) scale(0.985)`.
- 44 × 0.985 = 43.34. That matches HEL-1311 `skeptic-final-2.md:71` ("Right after the sheet opens | 43.34"), so the root cause is confirmed.
- D5's `dialog.getAnimations({subtree: true})` covers this `CSSAnimation`.
- D5 also says "or an existing settle helper … prefer reuse". The existing `e2e/support/settleTransitions.ts` filters to `CSSTransition` only, so it would resolve immediately and leave the measurement mid-animation. That is a no-op settle a reuse-minded executor could pick. See CR3.
- Failability proof: an undersized control at 40px is a real red against the restored 43.5 threshold after the settle.

**Spec delta.**
- Both MODIFIED blocks carry the full original requirement text and every original scenario, verified line by line against `openspec/specs/heatmap-histogram-charts/spec.md`. They only add text and scenarios.
- The ADDED requirement is coherent with D1.
- Defect: the "SHALL therefore never share" sentence (CR2).

**Scope/AC coverage.**
- AC1 → 1.1, 1.2, 2.4, 3.1, 3.2, 3.4. AC2 → 1.3, 3.3. AC3 → 1.4, 1.5. AC4 → 2.1, 2.2. AC5 → 2.3.
- No placeholders. Non-goals respected.

### Verdict: REFUTE

### Change Requests

1. **D2 must never render negative zero.** Specify that each edge is rounded to `d` places and normalised so that −0 becomes 0 (for example, format `Math.round(e*10^d)/10^d + 0`) before formatting. Without this, values −0.1 to 0.5 in 6 bins render "-0.1 to -0.0" / "-0.0 to 0.1". Add that case as a spec scenario and as a task 3.1 unit test, with the expected labels "-0.1 to 0.0", "0.0 to 0.1" … "0.4 to 0.5". The negative-range test must be red before the fix.
2. **Resolve the contradiction between the D2 cap and the spec.** With `clamp(..., 0, 6)`, a range of 0 to 0.000001 in 4 bins yields identical labels, which falsifies D2's "always differ" reasoning and the spec's "Adjacent bins SHALL therefore never share an identical label". Pick one of these and make design, spec and tests agree:
   - (a) Raise the upper clamp so cap = 1 − floor(log10(width)) is never truncated (Intl supports `maximumFractionDigits` up to 100; 20 is a safe ceiling) and keep the SHALL. Keep the single-bin case at its own bound.
   - (b) Keep 6 and qualify the SHALL ("…when the bin width is at least 1e-5").

   Add a unit test for the chosen boundary.
3. **D5: pin the settle mechanism to one that waits for `CSSAnimation`.** Name `Modal.css:19`'s `ui-modal-in` keyframe as the thing being waited out. Explicitly rule out `e2e/support/settleTransitions.ts`, which filters to `CSSTransition` and would be a silent no-op here. Either use the dialog-scoped `getAnimations({subtree:true})` wait, or a rect-stability wait like `touchTargetProbe.ts`'s `waitForSettledRect`.

### Non-blocking notes
- D5's optional "without the wait" run is reproducible (43.34 right after open, per HEL-1311 skeptic-final-2), and it is the red that proves the settle itself does work. Recommend making it mandatory rather than optional.
- Task 3.2: the heatmap y-axis assertion should also confirm the histogram's y (value) axis does NOT get `interval: 0`.
- The tolerance `1e-9*max(1,|e|)` is fine for realistic magnitudes; no change needed.
