## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 60909ebd4c5e756dafe1bb49e109b4cb8ee568d9. No code has been written yet; the change dir is untracked.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/chart-time-axis-followups/HEL-1517`.
I read lane-constraints.md first and followed it: no .env reads, no servers, no probes started, and all reads were inside the worktree.

### What I verified (with evidence)

**Round-2 CR 1 (register MarkPointComponent and prove the marker renders) is addressed.**
- Design D4 now names `echartsCore.ts` and says to add `MarkPointComponent` to `echarts.use`. The proposal's Impact
  list includes `echartsCore.ts (register MarkPointComponent)`.
- D7 and task 3.3a add a rendered-level e2e check in the new `e2e/hel1517-chart-followups.spec.ts`. It uses the
  markPoint model plus a zrender or pixel check at `convertToPixel`.
- Task 3.2 includes the mutation "MarkPointComponent removed -> hel1517 e2e red".
- Task 3.5 now covers "isolated marker visible light+dark".
- I re-checked the premise in the live tree. `frontend/src/features/panels/ui/echartsCore.ts:19-48` still registers
  Grid, Legend, Tooltip, VisualMap, MarkLine and MarkArea only. The prior probe output
  (`.concertino/scratch/HEL-1517/skeptic-d2-probe5.out`) shows `symbols: []` without MarkPoint and the right two
  pixels with it.
- I re-read the round-1 CRs. CR1 (category index as the coord) is in D4 and has a spec scenario. CR2 ("same time"
  copy) is in the spec, and so is the intraday scenario. CR3 (an independent brute-force oracle) is in D7 and task 3.1.

**I checked each decision against ground truth myself.**
- **D1 (tick floor).**
  - echarts `lib/scale/Time.js:560-563` clamps `approxInterval` up to `minInterval`.
  - `buildChartOption.ts` has one xAxis spread for both raw and aggregate time options, and it sits after the
    appearance spread. That is where `type: "time"` is already forced, so it is the right place for `minInterval`.
  - Time formatting is UTC (`timeAxisOption.ts:72` `useUTC: true`; `chartTimeAxis.ts:61` `allMidnightUtc`), so
    UTC-divisibility granularity matches the rendered labels.
- **D2 (summing).**
  - Last-wins is confirmed in both builders: the category builder at `chartDataOptions.ts:205-212` (`lookup[g][x] = y`)
    and `buildTimeMultiSeries` in `chartTimeDataOptions.ts`, which keys by instant.
  - Multi-series never takes the category fallback: `chartTimePlan.ts:75` sets `onePointPerRow` from
    `yCol === -1 || seriesCol === -1`.
  - `CHART_TYPES` is `bar, line, pie, scatter, heatmap, histogram` (`utils/chartTypes.ts:3`). So "line or bar" is
    exactly the multi-series branch.
  - `ChartRenderer.tsx:96-111` already derives its footnote from `resolveChartPlan` over the same props `ChartPanel`
    receives. A sibling `summedRowsNote` over those props can therefore key exactly as the builder does.
- **D3 (scatter x).**
  - The `isNaN(xVal) ? 0` fallback is at `chartDataOptions.ts:141-142`. The `plotted` filter at `:139` only checks y.
  - The derivation to exclude-with-footnote holds. The same chart type on a time axis already footnotes an
    unreadable x (`timeAxisOmittedNote`), so a silent drop would be inconsistent within one chart type. I see one
    plausible behaviour, so no escalation is needed.
- **D4 (isolated markers).**
  - `applyLine` (`utils/chartTypeOptions.ts:36-50`) is the only app setter of `showSymbol` for panel charts. The
    other hit is in an unrelated admin chart.
  - The passes that run later do not move category indexes:
    - `applyChartOverlay` aligns to the existing `xAxis.data` (`chartOverlayOption.ts:95-96`) and adds its own series.
    - `relabelBlankCategory` renames but does not reorder.
    - Horizontal swap and stacking are bar-only.
  - So `coord: [i, y]` / `[t, y]` stays the drawn position.
  - Time multi-series emits `null` at shared instants, so the neighbour test sees gaps there as intended.
- **D5.** There is one `chart-panel__skipped-note` `<p>` with `title` (`ChartRenderer.tsx:151-155`). The 375 px
  truncation trade-off is stated, and task 3.5 records it.
- **D6.** `buildChartOption.ts` is 426 lines. The frontend ESLint config has no `max-lines` rule, so the two added
  lines are not gated. I checked the compact pass: the change does not touch it.
- **D7 GUARD.** `resolveDataColumns` (`utils/chartClickSelection.ts:27-38`) gives `yCol = -1` when there is no yAxis.
  So an `{xAxis, series}` mapping plans `category-fallback` for a repeated-instant vertical bar, and mutating
  `onePointPerRow` to `seriesCol === -1` flips it. The GUARD can fail.

**ACs to tasks.**
- Red-first with mutations for items 1-4: tasks 1.1-1.4, 3.2.
- Item-5 GUARD and the e2e positive control: tasks 1.5, 3.3.
- UI check at 375 px and desktop, both themes, with the summed footnote: task 3.5.
- Full jest suite: task 3.4.
- Frontend only, with no API, schema or migration impact, so no contract delta is needed. There are no TODO or TBD
  markers.

**Owner rulings (relayed by the driver, treated as a claim).** I could not verify their provenance from the tree.
They are consistent with the ticket's own framing: item 2 says "Product call: sum, warn, or keep the last", and
item 3 says "excluded". The design follows them.

I looked for open product forks and found none that needs escalating:
- Item 3's footnote-or-silent question is settled by the same-chart-type precedent on the time axis.
- Item 2's "N points were combined" vs the design's count of every row that took part is a wording detail. The ruling
  delegates wording to DESIGN.md.

### Verdict: CONFIRM

### Non-blocking notes
- **Spec scope of the scatter requirement.** It reads "A `scatter` chart whose x is not on a time axis SHALL draw no
  point for a row whose x value is not numeric".
  - A scatter with no yAxis mapping does not take the scatter branch. It falls through to the auto-detect category
    path (`chartDataOptions.ts:255-270`), where x is a category, so the "plotted at 0" defect never existed there.
  - D3 is explicit that only the `yCol !== -1` scatter branch changes, so the implementer cannot misread it.
  - Consider adding "with a mapped y field" to the requirement so the final gate does not read it literally against
    the unmapped path.
- **Paths in the proposal's Impact list.**
  - It omits `buildChartOption.ts`, which D1 and D6 both say gets the `minInterval` lines.
  - Its `utils/...` paths are relative to `frontend/src/`, not to `features/panels/ui/`.
  - It hedges "`utils/chartTimePlan.ts` (or a sibling echarts-free notes module)" while D2 commits to
    `utils/chartSeriesNotes.ts`.
  - None of these blocks implementation.
- **markPoint colour.** markPoint symbols take the series palette colour by default. The light/dark check in task 3.5
  should confirm that the isolated marker matches its line's colour in both themes.
