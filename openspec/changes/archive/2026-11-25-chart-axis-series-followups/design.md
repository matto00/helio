## Context

Chart data is built in `frontend/src/features/panels/ui/chartDataOptions.ts` (category axis, scatter, dispatch) and
`chartTimeDataOptions.ts` (time axis); `buildChartOption.ts` merges data and appearance and sets `type: "time"` on the
x axis when `plottedInstants(dataOption)` is non-null. `ChartRenderer.tsx` renders one footnote,
`histogramSkippedNote ?? timeAxisOmittedNote(resolveChartPlan(...).timePlan)`, both echarts-free so the main bundle
does not pull the lazy echarts chunk (HEL-512). `utils/chartTypeOptions.ts` `applyLine` sets `showSymbol: false`
when `showPoints === false`. ECharts is 6.1.0: `LineView.js` (~line 504-541) builds no symbols at all when
`showSymbol` is false, so a per-item `symbol` cannot re-show one point.

## Goals / Non-Goals

Goals: the four spec requirements in `specs/chart-field-data-rendering/spec.md`, with footnote counts that cannot
disagree with what the builder plotted. Non-goals: see proposal.md; also no change to the default-markers case
(`showAllSymbol: "auto"` sampling on dense category axes is ECharts' existing behaviour).

## Decisions

**D1 Tick floor (item 1).** Add an echarts-free `timeAxisMinInterval(instants): number | undefined` to
`utils/chartTimeAxis.ts` (next to `allMidnightUtc`): the largest of day/hour/minute/second (ms) that divides every
instant in UTC, else `undefined`. Applied in `buildChartOption.ts` in the same spread that already forces
`type: "time"` (`timeInstants ? { type: "time", minInterval } : {}`), after the appearance spread, so the
appearance's category `xAxis` can never clobber it and raw-row and aggregate time charts share one site.
Alternative rejected: setting it in each time builder's `xAxis` (five sites, and it relies on the appearance spread
never carrying `minInterval`). The executor MUST confirm in `node_modules/echarts` that the 6.1.0 time scale honours
`minInterval`, and the UI check confirms no time-of-day label on daily data at 375 px.

**D2 Summing (item 2, owner ruling: sum + footnote).** New echarts-free module `utils/chartSeriesNotes.ts`:
`sumBySeriesAndKey(rows, keyOf, yCol, seriesCol)` returns `{ sums: Map<series, Map<key, number>>, summedRows }`,
where non-numeric y rows are skipped and `summedRows` counts every numeric row in a cell holding two or more numeric
rows. Category multi-series keys by raw x (`row[xCol] ?? ""`) over `rawRows`; `buildTimeMultiSeries` keys by instant
over `plan.timed`. Both builders call it, replacing their last-wins `set`. Footnote: `summedRowsNote(plan, rawRows,
headers, fieldMapping)` in the same module, applying only where `buildDataOptionCore` takes the multi-series branch
(rows source; chart type not scatter/pie/heatmap/histogram; x, y and series columns all resolved via
`resolveDataColumns`), keyed exactly as the builder keys. Wording (DESIGN.md principle 5, plain language, keyed exactly as
the builder keys; skeptic round 1 CR 2): category "N rows with the same x value and series were added together." / time
axis "N rows with the same time and series were added together." ("time", not "date": intraday rows on one date at
different instants are NOT summed). N >= 2 by construction, so no singular form. Non-numeric y: summing is undefined, so
such a row contributes nothing (it would be a gap alone); this is the only mapping where summing is impossible.
Alternatives rejected by the owner: keep-last, warn-only.

**D3 Scatter x (item 3).** The category-path scatter `plotted` filter also requires a numeric x; `toPoint` loses its
`isNaN(x) ? 0` fallback. Footnote "N rows with no numeric x value not shown." (singular "1 row ..."), counting every row
whose x is not numeric, from `scatterOmittedNote(plan, rawRows, headers, fieldMapping)` in `utils/chartSeriesNotes.ts`. Derivation, so
no escalation: every precedent for an unreadable value on a chart's X axis is excluded WITH a footnote (histogram "N
non-numeric values skipped.", time axis "N rows with no readable date not shown."); the only silent precedent is an
unreadable Y (a gap), which is a different axis. Counting all non-numeric-x rows regardless of y matches the date
note, which counts every unparseable-x row. Colour groups keep their legend entry even when all their rows are
excluded, as with non-numeric y today.

**D4 Isolated markers (item 4).** In `applyLine`, when `showPoints === false`, for each series find points whose y
(`pointY`, handles numbers and `{value:[t,y]}`) is numeric and whose existing neighbours (index -1/+1 in the series'
data order) are all null/absent; when any exist, add a `markPoint` to that series:
`{ silent: true, symbol: "emptyCircle", symbolSize: 4, label: { show: false }, data: [{ coord: [x, y] }] }` with x the
category INDEX `i` on a category axis (never the name: ECharts' `OrdinalScale.parse` resolves a name to its FIRST
occurrence, misplacing the marker when x repeats, and `relabelBlankCategory` later renames `"null"` to "(blank)";
skeptic round 1 CR 1), or the instant `value[0]` on a time axis. Chosen over re-enabling `showSymbol` with per-item
`symbol: "none"` (or a 0 `symbolSize`): those remove the hover marker ECharts draws today on every non-isolated
point of a markers-off line. `silent` keeps clicks out (`useChartClickHandler` also ignores non-`series` components).
`applyLine` runs before the overlay/reference-mark passes, which add their own series and are untouched. The app's
tree-shaken ECharts (`echartsCore.ts`) does not register `MarkPointComponent`, and an unregistered `markPoint` is
dropped silently (skeptic round 2 CR 1, probe `.concertino/scratch/HEL-1517/skeptic-d2-probe5.out`): add it to
`echarts.use` with a comment line like the MarkLine/MarkArea entries. If markPoint does not render as specified in the
running app, the executor stops and reports rather than switching mechanism.

**D5 One footnote line.** `ChartRenderer` joins the non-null notes in a fixed order (histogram, no-readable-date,
no-numeric-x, summed) with a space into the existing single `chart-panel__skipped-note` `<p>` (HEL-1444 one-line,
full text in `title`). No new CSS. At 375 px a date note followed by the summed note may truncate the
summed half (reachable via `title` only); task 3.5 checks a chart with both notes at 375 px and records the result.

**D6 No split (item 6).** Items 1-4 add two lines to `buildChartOption.ts`; the compact pass the split would move is
untouched by them, so it does not help. Left alone; raised as a follow-up triage at Delivery.

**D7 Tests.** Red first, committed as `.txt` before implementation (C12). Per item, mutations that must turn a test
red: (1) drop `minInterval`; return hour for whole-day data. (2) restore last-wins in the category branch and,
separately, in the time branch; count only the extra rows; count a non-numeric-y row. (3) restore x -> 0; drop the
note. (4) remove the markPoint; mark every point; mark a point with one numeric neighbour; use the category name as the
coord (caught by a case whose isolated point is the second occurrence of a repeated category). GUARD (labelled, item 5):
add an {xAxis, series} no-yAxis case to `chartTimePlan.test.ts`'s matrix (a repeated-instant vertical bar must plan
`category-fallback`), failable by mutating `onePointPerRow` to `seriesCol === -1` (skeptic M2); and a GUARD over a matrix of mappings and both axis types whose
oracle is independent of the implementation: the test brute-forces N and every expected sum from the input rows with
its OWN grouping (category keys by raw x, time keys by `parseChartInstant`; never `sumBySeriesAndKey`), then asserts
the note's N and that each multi-row point's plotted value equals the brute-force sum. The matrix includes a
two-spellings-one-instant pair and an intraday same-date pair; it must go red under the mutation "key the time note
by raw x instead of instant" and under "count only the extra rows". e2e positive control: in `e2e/hel1508-chart-time-axis-followups.spec.ts`, `showTip` on a real
point of the same line card asserts a non-empty tooltip containing its value, so the empty-at-gap assertion cannot
pass vacuously (mutation: wrong tooltip locator turns the control red); run it AFTER the gap assertion (or `hideTip`
between them) so stale tooltip content cannot leak either way. An RTL test renders `ChartRenderer` with two
applicable notes and asserts the joined line. Rendered-level e2e (new `e2e/hel1517-chart-followups.spec.ts`, lane DB,
2 workers): a line card with `showPoints: false` and an isolated value asserts on the live chart instance that the
marker is actually drawn (the markPoint component model holds the point, and a zrender display-list or pixel check at
its `convertToPixel` position); it must go red with `MarkPointComponent` removed from `echarts.use`. The same spec
asserts a daily time card's live `xAxis[0].minInterval` is one day and that a multi-series card shows the summed-rows
footnote.

## Risks / Trade-offs

- [Footnote count drifts from the builder] -> the builder and the note share `sumBySeriesAndKey`/the plan; GUARD
  matrix in D7.
- [markPoint changes legend toggle or morph animation] -> it belongs to the series, so it hides with it; series ids
  (HEL-1584) are unchanged. UI check covers it.
- [minInterval leaves a single-instant chart with one tick] -> acceptable; one date is shown.

## Planner Notes

- Self-approved: footnote wordings in D2/D3; markPoint mechanism; no item-6 split; item 3 derived, not escalated.
