## Context

See proposal.md and ticket.md (owner rulings Q1-Q3, ACs 1-6). Ground truth on main at 849dd96c9 (premise:
`.concertino/runs/HEL-1508/evidence/premise-validation.md` in the main checkout):

- `frontend/src/features/panels/ui/chartDataOptions.ts` `buildDataOptionCore` decides `timeX = wantsTimeAxis(chartType,
  timeCtx, headers[xCol])` once, then each cartesian branch either delegates to a time builder in
  `chartTimeDataOptions.ts` or runs its category code. Category single-series (~line 190) and auto-detect (~205)
  map NaN y -> 0; non-time scatter `toPoint` maps NaN x and y -> 0; multi-series already emits `null`.
- `chartTimeDataOptions.ts`: `timedRows` silently drops rows whose `parseChartInstant` is null and sorts the rest
  stably; `buildTimeSingleSeries`/`buildTimeAutoSeries`/`buildTimeScatter` use `numberOr0` for y;
  `buildTimeAggregate` drops categories that denote no instant (including the `"null"` group).
- `wantsTimeAxis` lives in `chartTimeDataOptions.ts`. That file has only type imports from echarts, but its runtime
  import of `utils/chartTypeOptions` pulls in a chart-option module. `utils/chartTimeAxis.ts` is the echarts-free home
  (HEL-512 lazy-chunk rule) of `isTimeXField`/`parseChartInstant`.
- `renderers/ChartRenderer.tsx` is in the main bundle and already derives a DOM footnote that the option builder
  can't render: `histogramSkippedNote` (HEL-1311 D5), shown as `<p className="chart-panel__truncation-note
  chart-panel__skipped-note">` after the HEL-1358 truncation note. It has `rawRows`, `headers`, `fieldMapping`,
  `chartAggregate` (with `groupBy`), `chartOptions` (bar orientation), `fieldTypes`, and `appearance.chart.chartType`:
  every input the time-axis decision needs.
- The tooltip `valueFormatter` already renders `null`/`undefined` as `—` (HEL-1305 D7a) on both axis types.
- Line `showSymbol` comes from `utils/chartTypeOptions.ts` (~43). `toPercentShares` already treats `null` as no
  value (HEL-1305 D5).
- A pipeline cast to `timestamp` (or legacy `date`, canonicalised to `timestamp` in `model.scala` ~452) is what
  gives a string column a declared `timestamp` type (`CastStep.SupportedTargets`).

## Goals / Non-Goals

**Goals:** ACs 1-5 under rulings Q1-Q3; one shared definition of "this chart plots on a time axis" that the
option builder and the footnote both use, so they can never disagree.

**Non-Goals:** an axis-type setting or editor control (Q3); value sniffing of string columns; any change to line,
scatter, multi-series or aggregate charts with repeated instants (Q1 names the raw-row single-series bar only); a
multi-series series with two rows at one x (last write wins today on both axes; pre-existing, a follow-up
candidate); a non-time scatter's non-numeric x, which still plots 0 (Q2 covers y; a follow-up candidate); pie's
`|| 0`; heatmap/histogram; any `buildChartOption.ts` restructuring beyond D1a's named edit (lines ~137-158
replaced by one call to the shared resolver). HEL-1512's compact-mode split is not taken here.

## Decisions

**D1 One echarts-free time-axis plan.** Move `wantsTimeAxis` (and the `TimeAxisContext` type) into
`frontend/src/utils/chartTimeAxis.ts`, re-exporting from `chartTimeDataOptions.ts` so existing imports keep
working. Add, in the same module, a pure function that resolves the whole decision for raw rows:
`planTimeAxis(rawRows, headers, fieldMapping, chartType, timeCtx)` ->
`{ kind: "none" } | { kind: "time", omitted: number } | { kind: "category-fallback" }`. It uses
`resolveDataColumns` (from `utils/chartClickSelection.ts`, which is echarts-free) and `wantsTimeAxis`, then applies D2's
fallback predicate, and counts the rows whose x denotes no instant (`omitted`). `buildDataOptionCore` uses this plan
instead of its own `timeX` computation, so the branch taken and the footnote come from the same call. A matching
`planAggregateTimeAxis(aggregate, chartType, timeCtx)` -> `{ kind: "none" } | { kind: "time", omittedGroups }`
serves `buildAggregateDataOption`. Heatmap/histogram/pie return `none` before any of this, as today.

**D1a One resolver for the whole chain (skeptic r1 CR1).** The decisions `buildChartOption.ts` (~137-158) makes
inline today — chart type (`resolveChartType(appearance?.chart ?? defaultChartAppearance)`, i.e. `line` when
absent), `timeCtx` (`fieldTypes` + `horizontalBar = chartType === "bar" && chartOptions?.bar?.orientation ===
"horizontal"`), aggregate-vs-raw (`chartAggregate != null` and chartType bar/line/pie), and the empty-rows
short-circuit (no rows/headers -> nothing plotted) — move into ONE exported, echarts-free function in
`utils/chartTimeAxis.ts` (it may import `resolveChartType`/`defaultChartAppearance` from `utils/chartAppearance.ts`,
whose only echarts import is `import type`; the executor confirms `defaultChartAppearance`'s home is likewise
runtime-echarts-free, or moves the constant):
`resolveChartPlan({appearance, rawRows, headers, fieldMapping, chartAggregate, chartOptions, fieldTypes})` ->
`{ chartType, timeCtx, source: "aggregate" | "rows" | "empty", timePlan }` where `timePlan` is D1's
`planTimeAxis(...)` for `rows`, `planAggregateTimeAxis(...)` for `aggregate`, `{kind:"none"}` for `empty`.
`buildChartOption` calls it and branches on `source` (passing `chartType`/`timeCtx`/`timePlan` down so the data
builders never recompute the plan); `ChartRenderer` calls the SAME function with the SAME props it forwards to
`ChartPanel` and feeds `timePlan` to D3's note. Nothing else re-derives chart type, aggregate-vs-raw or `timeCtx`.
Edge cases owned by the plan: an auto-detect time chart with no numeric column builds `{}` today, so the plan
returns `none` for it (no note under an empty chart); a scatter with no y mapping goes down the auto-detect branch
and follows that branch's rules (D4's auto-detect `null`, no fallback since it is not a bar). Each x is parsed once:
the plan carries the parsed instants (or the builder takes them from the plan), not a second parse.

**D2 Same-instant fallback (Q1).** Applies only when `chartType === "bar"` (vertical; horizontal is already `none`)
AND the branch emits one point per row: single-series (`yCol !== -1`, `seriesCol === -1`) or auto-detect (no y
mapping). If any two rows' x values parse to the same instant (compared by epoch millis, so two spellings of one
instant count as a repeat), the plan is `category-fallback`. The data option is then the category single-series
or auto-detect output over the rows reordered stably: rows whose x parses, ascending by instant, then rows whose
x does not parse, in row order. Unparseable rows keep their own bar on the category axis (the axis can label
them), so nothing is omitted and no D3 note is shown. `xAxis` is `{type: "category", data: <raw x strings in
that order>}`, the same shape the category branch emits today. Click selection (`params.name` = raw x) and
`filterRowsForSelection` are unchanged. A "vs" overlay aligns by category string as on any category axis.
Ruling Q1's "sorted by date" is satisfied, and "as before HEL-1305" holds for the axis type and per-row bars.
**Risk to verify in the running app:** ECharts must keep two equal category strings as two separate bars
(explicit `xAxis.data` is not deduplicated). If it does collapse them, the executor stops and escalates rather than
picking a different option.

**D3 Omitted-x note (item 2).** New pure, echarts-free `timeAxisOmittedNote(plan)` beside the plan (or in
`ChartRenderer.tsx` beside `histogramSkippedNote`):
- `omitted` rows: `"N row(s) with no readable date not shown."`, e.g. `"1 row with no readable date not shown."` /
  `"3 rows with no readable date not shown."`
- aggregate `omittedGroups`: `"N group(s) with no readable date not shown."`
- `null` when the count is 0 or the plan is not `time`.

`ChartRenderer` computes it in a `useMemo` from `resolveChartPlan(...)` (D1a), called with exactly the props it
forwards to `ChartPanel`. It never reads `appearance.chart.chartType` directly. It renders in the same slot and with the same classes as the histogram
note (`chart-panel__truncation-note chart-panel__skipped-note`, `title` = text). The two notes can't both apply
(histogram is never on a time axis). It is an aside for raw-row and aggregate time charts, on the panel card, the
editor preview and the History chart alike, since all three render through `ChartRenderer`. The count is over the
rows actually handed to the chart (the loaded rows), the same basis as the histogram note.

**D4 Non-numeric y is a gap (Q2).** On both axis types:
- category single-series: `isNaN(n) ? null : n`.
- category auto-detect: the same (a column still qualifies only if at least one cell is numeric).
- time single-series/auto: `value: [t, null]`; drop `numberOr0` for y (size keeps it).
- scatter, both axes and with or without `colorField`: a row whose y is non-numeric produces no point (filtered
  out). x handling and size are unchanged. `makeScatterSymbolSize` keeps computing its scale over all rows.
- D2's fallback output uses the same null rule.

Every downstream consumer of single-series `series.data` must accept `null`. The executor greps every reader
(`chartTypeOptions.ts`, including `toPercentShares` and data labels, `chartOverlayOption.ts`,
`referenceMarksOption.ts`, `buildChartOption.ts`, conditional-format or colour helpers, `chartClickSelection.ts`)
and lists each in the PR body with how it treats `null`. The tooltip formatter already renders null as `—` (reachable in multi-series axis tooltips). Line `connectNulls`
stays unset (a line breaks). Known consequence, the same as multi-series since HEL-1305: an isolated value between
two gaps on a line with `showSymbol: false` draws no visible mark. This is accepted and recorded as a follow-up
candidate, not fixed here.

**D5 Item 4 (Q3).** No code. The time-axis requirement states that a column declared `string` keeps a category
axis and that a pipeline `cast` to `timestamp` is how it gets a time axis.

**D6 Spec (item 5).** Modify "ChartPanel renders data from fieldMapping and rawRows" so that its categories
sentence reads as the default and cross-references "A timestamp x field renders on a time axis" and "A chart shows
a gap where a series has no numeric value". Modify the time-axis requirement for D2/D3/D5. Rename the multi-series gap
requirement to the general form and widen it per D4. The delta uses MODIFIED + RENAMED, and the executor confirms
`openspec validate` accepts it.

**D7 Tests (red first, output saved to the run evidence dir).** Unit tests, each shown RED on main before the fix:
(a) time-axis single-series bar with two rows at one instant -> `xAxis.type === "category"`, data in instant order,
both values present; the same chart with distinct instants stays `time`; a line with a repeated instant stays
`time`; a multi-series bar with a repeated instant stays `time`; a horizontal bar stays as today.
(b) auto-detect bar with a repeated instant -> category fallback.
(c) two spellings of one instant (`2026-10-01` and `2026-10-01T00:00:00Z`) -> fallback.
(d) fallback keeps an unparseable-x row as its own last bar.
(e) `planTimeAxis` omitted count, and the note text for 0/1/3 rows and 1 group; `ChartRenderer` renders the note
on a time chart with an unparseable x and not on a category chart (RTL test).
(f) category and time single-series, and auto-detect, with a non-numeric y -> `null`; scatter (category and time,
with and without colorField) omits the point.
(g) `toPercentShares` with a single-series null.
(h) the tooltip `valueFormatter` renders a null value as `—` (the text a multi-series axis tooltip shows for a missing value); a single-series gap draws no mark, so it has no hover target.
Existing tests that pin NaN -> 0 on single-series/auto/scatter-y are updated, and each such update is listed in the
PR body as an intended behaviour change, not a fixture fix. A full-chain GUARD test (skeptic r1 CR1) covers a
matrix of chart types (including absent `appearance.chart`) x raw/aggregate (including scatter WITH a
`chartAggregate`) x horizontal bar x aggregate grouped by a timestamp x repeated/unrepeated x
parseable/unparseable x auto-detect with no numeric column. For every case it asserts that
`resolveChartPlan(...).timePlan.kind` agrees with `buildChartOption(...).xAxis.type` (`time` <-> `"time"`;
`category-fallback`/`none` <-> not `"time"`), and that the note is non-null exactly when the kind is `time` with a
non-zero count. It is labelled GUARD and mutation-proven by two mutations, each shown red: (i) flip the fallback
predicate; (ii) make `buildChartOption` compute its own `horizontalBar` and ignore the plan.

**D8 Running-app check.** Dev servers on this worktree's ports (6940/9847). Use a throwaway `@example.test` user
registered by the agent; record its id up front and verify it through `/api/auth/me`; never touch
matt@helio.dev. Create (recording every id, deleting by exact id at the end) a dataset or CSV source with a
`timestamp` x column containing two rows on one date, one unparseable x (e.g. `n/a`) and one non-numeric y, a
pipeline, and Outputs: single-series vertical bar (fallback), single-series line (time axis plus omitted note plus a
y gap), scatter (point omitted, note), aggregate bar grouped by the date (null group note), and a string-x
single-series bar (category, y gap, no note). Screenshot each in light and dark at 1440 and 375. Measure in the
browser that the fallback bar chart draws two distinct bars for the repeated date, and that the gap draws no 0
bar or line vertex. Confirm a single-series gap has no hover target (no tooltip, so no 0). Run the e2e specs hel1305, hel1306, hel1311 and hel1512. The shared
Playwright MCP writes to the main checkout's `.playwright-mcp/`; move your own files from there into
`.concertino/runs/HEL-1508/evidence/`, or use your own headless scripts.

**D9 Round-2 skeptic notes folded in.** (a) Import `defaultChartAppearance` from `theme/appearance.ts`, which
is all type-only imports (its real home, not `utils/chartAppearance.ts`). Do not move it. (b) The builders take
the plan as a trailing optional parameter. When it is absent they compute it with the same `planTimeAxis` /
`planAggregateTimeAxis`, so existing direct callers and tests keep working. The `time`/`category-fallback` plan
variants carry the parsed instants, so a builder that receives the plan does not parse x again. (c) Guard
mutation (ii) must make the local `horizontalBar` actually differ from the resolver's (e.g. always `false`), not
copy it faithfully. (d) The plan owns the "auto-detect has a numeric column" rule and the aggregate line/bar-only
rule. Both stay in the guard matrix.

## Risks / Trade-offs

- [ECharts deduplicates equal category strings] -> D2's risk: verified first in the running app; escalate if so.
- [Gap-everywhere changes existing single-series dashboards that relied on 0 for blanks] -> this is the owner's
  ruling Q2. The PR body names it as a visible behaviour change.
- [Note and builder disagree] -> D1a's single resolver, used by both `buildChartOption` and `ChartRenderer`, plus
  D7's full-chain guard.
- [`buildChartOption.ts` edit] -> limited to D1a: lines ~137-158 replaced by the resolver call, nothing else.
- [A fallback bar becomes eligible for the "vs" overlay] -> intended. A fallback chart is an ordinary category
  single-series chart, and `applyChartOverlay` aligns by category string (the first match wins for a repeated
  date). A test pins it.
- ECharts in `frontend/node_modules` is 6.1.0. Skeptic r1 verified that an explicit `xAxis.data` is not
  deduplicated: a repeated category renders as two bars. D2's risk is retired, though the running-app check
  still measures it.
- [HEL-1510 touches Output editor files] -> this change edits no editor file. Re-sync with origin/main before the PR.
