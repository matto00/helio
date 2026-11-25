## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 60909ebd4c5e756dafe1bb49e109b4cb8ee568d9 (no code yet; change dir untracked).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/chart-time-axis-followups/HEL-1517`.

### What I verified (with evidence)

**D1 (tick floor), sound.**
- echarts in the worktree is 6.1.0 (`frontend/node_modules/echarts/package.json`).
- `lib/coord/axisNiceTicks.js:184` passes `minInterval` to time scales (`isIntervalOrTime`), and
  `lib/scale/Time.js:559-567` (`calcNiceForTimeScale`) clamps `approxInterval` up to it. So the time
  axis honours `minInterval`.
- Possible catch I checked: with `approxInterval = 1 day`, `bisect` picks `day` (1.2 d) and sets
  `minLevelUnit = 'half-day'` (`Time.js:574`). `createIntervalTicks` (`Time.js:319-490`) still
  stops at the day level, because day ticks with `getDateInterval(1 d) = 1` number
  `floor(span/day)+1 > targetTickNum = span/approx`. When approx is above 1.5 d, `minLevelUnit` is `day`
  or coarser. Edge ticks off the data are `notNice` and their labels are dropped
  (`component/axis/AxisBuilder.js:672`). The axis is UTC (`timeAxisOption.ts:65`), so UTC-day
  granularity matches the tick grid.
- `buildChartOption.ts:213-218`: the xAxis spread `...(timeInstants ? { type: "time" } : {})` comes after
  the appearance spread, and the compact pass (`:387-389`) keeps the other `xAxis` keys. `plottedInstants`
  (`timeAxisOption.ts:20`) covers raw-row and aggregate time options. Putting it there is right: it is the
  one place both paths go through.

**D2 (summing), mechanism sound, copy and GUARD need revision.**
- Last-wins confirmed at `chartDataOptions.ts:205-212` (category) and `chartTimeDataOptions.ts:59-67`
  (time). Category keys by raw x over `rawRows`; time keys by instant over `plan.timed`. The plan
  never falls back to category for multi-series, because `chartTimePlan.ts:75` gives
  `onePointPerRow = false` when y and series are both mapped. The design's "keyed exactly as the
  builder keys" is achievable.
- The "rows" count definition (every numeric row in a cell of 2 or more) matches the existing
  "N rows with no readable date" counting style. The spec scenario with non-numeric y shows no footnote,
  which agrees with that definition.
- The time-axis wording is factually wrong for intraday data (CR 2).
- The GUARD oracle is not specified (CR 3).

**D3 (scatter x), one plausible behaviour, so no escalation needed. I concur.**
- `chartDataOptions.ts:139-142` confirms the `isNaN(x) ? 0` fallback.
- The owner ruled "excluded", so the only open question is footnote or silent. There is a stronger
  precedent than the ones the design cites: the same chart type on the same axis already footnotes.
  A time-axis scatter with an unreadable x is counted in `plan.omitted` and footnoted. The live e2e
  asserts this: `e2e/hel1508-chart-time-axis-followups.spec.ts:303`, scatter card
  `toHaveText(NOTE)`. A silent drop on the non-time scatter would contradict its own time-axis twin.
  The silent precedent applies only to y. I do not see a second plausible behaviour.

**D4 (isolated markers), mechanism right, coordinate wrong (CR 1).**
- `LineView.js:504-516`: with `showSymbol` false, `symbolDraw.remove()` runs and nothing builds
  symbols (`showSymbol && symbolDraw.updateData`). So per-item `symbol` cannot re-show a point.
  `markPoint` is a sound choice, and the design's reason for rejecting per-item `symbol: "none"`
  (it would kill the hover marker) holds.
- `Ordinal.js:84-96`: `OrdinalScale.parse` resolves a string coord through `getOrdinal(name)`, which
  is the FIRST index with that name. A number is used as an index. The design takes the category
  coord from `xAxis.data[i]`, which is wrong in two cases:
  (a) A single-series category line whose x repeats (`chartDataOptions.ts:229` keeps one category per
      row, duplicates included). The marker lands on the first duplicate, not the isolated point.
  (b) An aggregate line: `relabelBlankCategory` (`blankLabel.ts:51-75`) runs after
      `applyChartTypeOptions` (`buildChartOption.ts:255` then `:279-281`) and renames the axis's
      `"null"` category to "(blank)". A coord of `"null"` then parses to NaN, and the marker is not
      drawn when the aggregate's only group is null.
- I checked `applyChartOverlay` (`chartOverlayOption.ts:89-97`). It aligns to the existing categories
  and never rewrites `xAxis.data`, so an index coord is stable through the later passes.

**D5 (joined footnote).** `ChartRenderer.tsx:114-158`: today there is one `skipped-note` `<p>` with
`title`, and the CSS is in `PanelContent.css:428`. Joining the notes into it needs no new CSS.
See the non-blocking note on truncation at 375 px.

**D6 (no split), sound.** `buildChartOption.ts` is 426 lines. Items 1-4 add about two lines there and do
not touch the compact pass (`:359-420`). The owner's condition "split only if helpful to 1-4" is
not met, so leaving it and raising a follow-up triage follows the ruling.

**D7 (tests).**
- The M2 GUARD can fail. The existing matrix (`chartTimePlan.test.ts:180-222`) has no
  `{xAxis, series}` dataset without a yAxis. Its oracle `expectedKind` (`:284`,
  `!hasSeriesMapping || autoDetect`) is independent of `planTimeAxis`. A new dataset with
  `hasSeriesMapping: true`, no `yAxis`, a numeric column and a repeated instant expects
  `category-fallback` for a vertical bar. The mutation `onePointPerRow = seriesCol === -1` yields
  `time`, so the test goes red.
- The e2e positive control is real. The line card's ys are `[5, 9, null, 7]` (`spec.ts:286`).
  `showTip` at a numeric index has a symbol, because markers default to on, so the control proves
  that the tooltip mechanism and the `.chart-tooltip` locator work. A wrong locator turns the
  control red.
- The summed-note GUARD's oracle is unspecified (CR 3).
- I checked the unchanged-path GUARD (`unchangedPathCases.ts`). Its multi-series cases have distinct
  x+series and no `showPoints: false`, so items 2 and 4 should not move that snapshot. If it moves,
  that is a defect, not something to regenerate.

**Scope, ACs and contracts.** Every AC maps to a task: 1.1-1.5, 3.1-3.5. Frontend only, and no API or
schema change, so no contract delta is missing. No TODO, TBD or deferred decisions.

**Owner rulings (relayed by the driver).** Treated as claims. They are internally consistent with the
ticket text and the design applies them as written. I made no independent check of their
provenance; that is outside what this gate can verify from the tree.

### Verdict: REFUTE

### Change Requests

1. **D4: use the category INDEX as the markPoint coord, not `xAxis.data[i]`.** ECharts resolves a string
   category coord to the first category with that name (`echarts/lib/scale/Ordinal.js:84-96`). The
   design's coord therefore misplaces the marker on any category line with repeated x values
   (`chartDataOptions.ts:229`). It also drops the marker when `relabelBlankCategory` later renames
   `"null"` to "(blank)" (`buildChartOption.ts:279-281`). Amend D4 to `coord: [i, y]` on a category
   axis (the instant `value[0]` on a time axis is fine). Add a D7 unit case with a repeated category
   whose second occurrence is isolated, plus a mutation (name coord) that turns it red.
2. **D2/spec: fix the time-axis footnote copy.** "N rows sharing a date and series were summed." is
   false for intraday data: rows at 01:00 and 02:00 on one date share a date but are NOT summed,
   because the builder keys by instant. Use wording that matches the key, for example "N rows sharing
   a time and series were summed." or "…with the same timestamp and series…". Update design D2, the spec
   requirement text and the spec scenario together.
3. **D7/tasks 3.1: name an independent oracle for the summed-note GUARD.** "N equals the number of rows
   behind multi-row points in the built option" cannot be read from the built option, which holds only
   sums. If the test computes N through `sumBySeriesAndKey`, the GUARD is tautological and a
   count mutation in that helper changes both sides. Specify that the GUARD brute-forces N from the
   input rows with its own grouping: category keys by raw x, time keys by `parseChartInstant`. It
   should also assert each multi-row point's plotted value equals the brute-force sum. Name the
   mutation it must catch, for example keying the time note by raw x instead of instant, using a
   two-spellings-one-instant row in the matrix.

### Non-blocking notes

- D2/D3 copy: "sharing an x" and "no numeric x" use a bare axis letter. Consider plain-language phrasing
  in line with DESIGN.md principle 5, for example "N rows with the same x value and series were added
  together." The final gate will judge this against the running app.
- D5: the joined note is one line with an ellipsis. At 375 px, a date note followed by the summed note
  will likely truncate the summed half, which is then reachable only through `title` (no hover on
  touch). The 3.5 UI check should look at a chart that has both notes at 375 px, or state that this
  is acceptable.
- D3: cite the time-axis scatter precedent (`hel1508` e2e `:303`) in the derivation. It is the
  strongest one.
- e2e control: run the positive control AFTER the empty-at-gap assertion, or `hideTip` between them, so
  stale tooltip content cannot leak into the gap check in either order.
- D2: `summedRowsNote` should take the same `plan` the builder used (via `resolveChartPlan`) and not
  re-plan. The design says so; keep it that way in implementation.
