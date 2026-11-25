## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 60909ebd4c5e756dafe1bb49e109b4cb8ee568d9. No code has been written; the change dir is untracked.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/chart-time-axis-followups/HEL-1517`.
Probe scripts and their outputs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1517/skeptic-d2-probe*.{cjs,mjs,out}`.
They are durable lane scratch in the main checkout, outside the worktree.

### What I verified (with evidence)

**Round-1 change requests: all three are addressed in the artifacts.**
- CR1 (the markPoint coordinate is the category index): design D4 now specifies `coord: [i, y]` on a category axis.
  D7 adds the mutation "use the category name as coord", caught by a case where the isolated point is the second
  `a`. The spec has a new scenario, "An isolated point on a repeated category is marked where it is drawn".
- CR2 (the time-axis copy): D2 and the spec now say "N rows with the same time and series were added together.",
  and the spec has an intraday not-summed scenario.
- CR3 (an independent oracle): D7 and task 3.1 now require a brute-force grouping of the test's own (raw x /
  `parseChartInstant`), never `sumBySeriesAndKey`. It must assert N and the plotted sums, and go red under
  raw-x time keying and under extra-rows-only counting.
- Round-1 non-blocking notes: the plain-language copy, the ordering of the e2e control, the 375 px two-note check
  (task 3.5) and the reuse of `plan` are all folded in.

**D1 tick floor: sound, measured.**
- echarts is 6.1.0. `lib/coord/axisNiceTicks.js:180-185` passes `minInterval` to time scales, and
  `lib/scale/Time.js:562-565` clamps `approxInterval` up to it.
- Rendered probe (`skeptic-d2-probe.cjs`, real echarts 6.1.0 with an SSR chart, `useUTC`, `hideOverlap`):
  - Without `minInterval`, 2- and 3-day daily data at 300 px and 900 px label `04:00`/`08:00`/`12:00`... ticks.
    This is the ticket's defect.
  - With `minInterval: 86400000`, the labels are only `Oct  2` / `Oct  2  3`.
  - 5- and 14-day data is unchanged either way.
- The site is right: `buildChartOption.ts:214-218` is the one xAxis spread that both raw and aggregate time
  options pass through, after the appearance spread. `plottedInstants` (`timeAxisOption.ts:20`) is already
  computed there.

**D2 summing: sound.**
- Last-wins is confirmed at `chartDataOptions.ts:205-212` (category, keyed by raw x over `rawRows`) and at
  `chartTimeDataOptions.ts:59-67` (time, keyed by instant over `plan.timed`, which is sorted at `chartTimePlan.ts:72`).
- Multi-series never takes `category-fallback`: `onePointPerRow` is false when y and series are both mapped
  (`chartTimePlan.ts:75`). So "keyed exactly as the builder keys" is achievable with two keyings.
- The note's applicability condition (rows source; not scatter/pie/heatmap/histogram; x, y and series resolved)
  matches the branch order in `buildDataOptionCore` (`:111-199`) and `resolveChartPlan`'s `useAggregate` rule
  (`chartTimePlan.ts:133`).
- The auto-detected-series exclusion is right. Neither the category auto path (`:243-257`, one category per row)
  nor the time auto path (`chartTimeDataOptions.ts:97`, one point per row) is last-wins.

**D3 scatter x: sound, and there is one plausible behaviour, so no escalation.**
- The `isNaN(x) ? 0` fallback is at `chartDataOptions.ts:141-142`.
- `parseFloat` makes `""` NaN, so an empty x is excluded and counted. That is consistent with the y rule at `:139`.
- I concur with round 1's derivation. The owner ruled "excluded". The time-axis twin of the same chart type
  already footnotes its unreadable x (`timeAxisOmittedNote`; hel1508 e2e scatter card), so a silent drop would
  contradict it.

**D4 isolated markers: the mechanism and coordinate are right, but it cannot render in the app as planned (CR 1).**
- `chartTypeOptions.ts:36-50` `applyLine` only sets `showSymbol: false`. No line type is stacked or horizontal
  (`applyBar` owns stacking and orientation), so the coordinate `[i, y]` / `[t, y]` is the drawn position.
- Probe with full echarts (`skeptic-d2-probe3.cjs` -> `.out`):
  - Index coordinates `[0,1],[2,3]` on categories `a,b,a` render at pixel `[165,168],[465,65]`, which equals
    `convertToPixel` for those points.
  - Name coordinates `["a",1],["a",3]` render both markers at x=465: misplaced. This confirms the CR1 choice.
  - Time coordinates `[t,y]` render at the expected pixels.
- **But the app does not register `MarkPointComponent`.** `frontend/src/features/panels/ui/echartsCore.ts:19-48`
  registers Grid, Legend, Tooltip, VisualMap, MarkLine and MarkArea only. Probe `skeptic-d2-probe5.mjs` uses the
  same tree-shaken `echarts/core` registration (no MarkPoint). It draws **zero** marker symbols and logs **no**
  error or warning. Adding `MarkPointComponent` draws both markers at the right pixels.
  (`Global.js:136`'s "used but not imported" check covers top-level option keys only, not a series-level
  `markPoint`.)
- So D4 as written passes every option-level unit test in tasks 1.4 and 2.4 and renders nothing in the running
  app. Neither the proposal's Impact list nor design D4 mentions `echartsCore.ts`. Task 3.5's UI check also omits
  item 4. The Risks line "UI check covers it" therefore points at a check that does not exist.

**D5 joined footnote: acceptable.**
- `ChartRenderer.tsx:113-158` has one `skipped-note` `<p>` with `title`. `PanelContent.css:207-221` gives it a
  2-line clamp, and a 1-line clamp on short cards (`:446-453`); the phone stack is exempt.
- Task 3.5 records a two-note chart at 375 px. Truncating the second note behind `title` is a stated trade-off,
  and HEL-1444 already set that precedent.

**D6 no split: follows the relayed ruling.** Items 1-4 add about two lines to the 426-line `buildChartOption.ts`
and do not touch its compact pass.

**D7 tests: the M2 GUARD can fail.**
- `resolveDataColumns` (`chartClickSelection.ts:27-38`) gives `yCol = -1` when there is no yAxis mapping. So
  `{xAxis, series}` without a yAxis has `onePointPerRow = true` and plans `category-fallback` for a repeated-instant
  vertical bar. The mutation `seriesCol === -1` flips it to `time`.
- The e2e file and the `showTip` gap assertion exist (`e2e/hel1508-chart-time-axis-followups.spec.ts:291-298`).

**Scope, ACs and contracts.**
- Every AC maps to tasks 1.1-1.5 and 3.1-3.5.
- Frontend only, with no API or schema change, so no contract delta is needed.
- There are no TODO or TBD markers.

**Owner rulings (relayed by the driver, treated as a claim).**
- They are internally consistent with the ticket's own framing: item 2 says "Product call: sum, warn, or keep the
  last", and item 3 says "excluded".
- I could not verify their provenance from the tree.
- I found no item where the ticket and rulings leave two plausible product behaviours open. Item 3's
  footnote-or-silent question is settled by the same-chart time-axis precedent. Item 2's counting definition is a
  wording detail inside the ruling, not a product fork.

### Verdict: REFUTE

### Change Requests

1. **D4 / proposal Impact / tasks: register `MarkPointComponent` and prove the marker renders.**
   - The app's tree-shaken ECharts (`frontend/src/features/panels/ui/echartsCore.ts:19-48`) does not register
     `MarkPointComponent`. A series `markPoint` is then silently dropped, with no console warning. The probe
     `.concertino/scratch/HEL-1517/skeptic-d2-probe5.out` shows `symbols: []` without it and the correct two
     pixels with it.
   - Amend D4 and the proposal's Impact list to add `MarkPointComponent` to `echartsCore.ts`, with a comment line
     like the MarkLine/MarkArea entries.
   - Add a rendered-level check for item 4 that an option-only unit test cannot fake. For example, an e2e card with
     `showPoints: false` and an isolated value, asserting that the chart instance actually draws the marker (the
     markPoint component model exists and has the point, or a zrender display-list or pixel check at the point's
     `convertToPixel`). Removing `MarkPointComponent` from `echarts.use` must turn it red; list that in D7 and task 3.2.
   - Add item 4 (an isolated marker visible, in light and dark) to task 3.5's UI check, so the Risks line "UI check
     covers it" refers to a task that exists.

### Non-blocking notes

- Copy: "N rows with no numeric x not shown." still uses a bare "x". The summed note says "x value". Consider
  "x value" in both for consistency ("N rows with no numeric x value not shown."). The final gate will judge this
  against the running app.
- D1: the unit test checks `xAxis.minInterval` only. The rendered-label guarantee in the spec ("no time of day at
  375 px") rests on the task 3.5 UI check. The probe above shows the mechanism works in echarts 6.1.0, so this is
  low risk.
