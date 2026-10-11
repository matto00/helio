## Context

See proposal.md (Why) and ticket.md (owner rulings 1-5). Ground truth on main at 3eb0cc893, re-derived in
`.concertino/runs/HEL-1305/evidence/premise-validation.md`:

- Render path: `OutputPanelContent` (has `output.schema` from `useOutputMeta`; `PublicOutputMeta.schema` on the
  public path) -> `ChartOutputPanel` -> `ChartRenderer` -> `ChartPanel` -> `useChartOption` -> `buildChartOption`.
  Other `ChartRenderer` callers: `OutputPreviewPane` (editor preview) and `HistoryChart` (History view).
  `buildChartOption` receives only stringified `rawRows: string[][]` + `headers`; NO field types reach it today.
- `buildChartOption` merges `xAxis` as `{...dataOption.xAxis, ...appearanceOption.xAxis, ...}` and
  `appearanceToEChartsOption` (`utils/chartAppearance.ts` ~206) hard-codes `type: "category"`, so any axis type
  a data builder sets is overwritten today. `defaultOption.xAxis` carries `data: []`.
- `chartDataOptions.ts` `buildDataOptionCore`: multi-series branch (`seriesCol !== -1 && yCol !== -1`) builds
  `allX` in first-seen order and `lookup[g]?.[x] ?? 0`; single-series and auto-detect branches use category axes
  (NaN y -> 0); scatter emits `[x, y(, size)]` from `parseFloat` (a date x parses to its year) and sets NO
  `xAxis`, so it inherits the appearance category axis. `buildAggregateDataOption` uses `aggregate.categories`
  (lexicographically sorted strings, `utils/aggregate.ts` ~119; a null group key is the string `"null"`).
- `chartOverlayOption.ts` `applyChartOverlay` returns its input unless `xAxis.type === "category"` with a
  `data` array and exactly one primary series; aligns by `String(x)`.
- `referenceMarksOption.ts` marks the VALUE axis (`yAxis`, or `xAxis` for a horizontal bar) and widens it via
  `dataMin`/`dataMax`; a time x axis does not touch it.
- `chartTypeOptions.ts` `toPercentShares` (normalized stacking) reads `Number(s.data[i])` positionally;
  horizontal orientation swaps `xAxis`/`yAxis`.
- `chartClickSelection.ts`: bar/line/aggregate clicks key on `params.name` (the category string); scatter keys
  on `String(params.value[0])`; `filterRowsForSelection` then matches row cells by string.
- Backend `TimestampParsing` (HEL-1314): `parseInstant` reads whole-number epochs (seconds; millis above
  9999999999), ISO instant/offset, tz-less `T`- or space-separated local date-times AS UTC, and bare
  `yyyy-MM-dd` as midnight UTC; `looksLikeTimestamp` (what makes schema inference type a column `timestamp`) also
  accepts `MM/dd/yyyy`. JS `Date.parse` reads tz-less date-times as LOCAL time, so it cannot be used directly.
- Theme: ECharts cannot parse `color-mix()`; only hex-resolvable tokens may reach an option (no new colours are
  introduced here).

## Goals / Non-Goals

**Goals:** the three ACs; owner rulings 1-5; one frontend definition of "which instant does this x denote" that
provably agrees with the backend's; every existing non-timestamp chart renders an identical option.

**Non-Goals:** a config key or editor control for the axis type (ruling 1); value sniffing of string columns;
gap-filling missing buckets server-side (HEL-622); changing single-series / auto-detect NaN-y -> 0 semantics
(ruling 2 covers multi-series missing points only — recorded as a follow-up candidate); a time axis for horizontal
bars, pie, heatmap, histogram; changing reference-mark behaviour.

## Decisions

**D1 Field types reach the builder as `fieldTypes`.** `BuildChartOptionParams` (and `UseChartOptionParams`,
`ChartPanel`/`ChartRenderer` props) gain optional `fieldTypes?: Record<string, string> | null` — field name ->
declared schema type, built once per render site from `schema: {name, type}[]` with a memo. Wired at ALL
three `ChartRenderer` callers (skeptic r1 CR2 — the data is in scope at each):
`OutputPanelContent` -> `ChartOutputPanel` from `output.schema` (authenticated `Output` AND `PublicOutputMeta` —
both carry `schema`; the fullscreen overlay reuses this path, executor verifies); `OutputPreviewPane` from the
editor sheet's `capabilities.columns[]` (`{name, dataType}`, `OutputEditorSheet.tsx` ~121-134, built from
`SchemaField(c.name, c.dataType)` in `PanelCapabilityService.scala:96` — the same type vocabulary), so the editor
preview and the saved dashboard render identically; `HistoryChart` from its `output.schema`, where the looked-up x
field is `series.x` (for a grouped-mode series that is the aggregation's `groupBy` field, which is what the stored
summary keys on). No call site is left unwired; an exception is acceptable only with a ground-truth reason stated
in the PR body. Absent/`null` `fieldTypes` -> today's
behaviour exactly. `useChartOption`'s memo deps include it. Alternative "sniff values" rejected by ruling 1.

**D2 Time-axis decision is one pure predicate.** New echarts-free module `frontend/src/utils/chartTimeAxis.ts`:
`isTimeXField(fieldTypes, fieldName)` = `fieldTypes?.[fieldName] === "timestamp"`; the builder asks it for the
plotted x field (`headers[xCol]` from `resolveDataColumns`, or the aggregation's `groupBy` for the aggregate
path). The time axis is used only when that is true AND chartType is `line`, `scatter`, or `bar` with
`chartOptions.bar.orientation !== "horizontal"` (ruling 5). This covers every cartesian branch of
`buildDataOptionCore` that plots x: multi-series, single-series, scatter, AND the no-y-mapping auto-detect branch
(skeptic r1 CR5 — it gets the time axis too, sorted, `{name, value:[t, y]}` items, keeping its own NaN-y -> 0
semantics per Non-Goals; a test pins it). Every other case takes the existing code path unchanged — the existing
branches are not rewritten, a time branch is added beside them.

**D3 One frontend instant parser, pinned to the backend by a shared fixture.** `parseChartInstant(raw: string):
number | null` (epoch millis, UTC) in `chartTimeAxis.ts` accepts exactly backend `parseInstant`'s set (same
epoch seconds/millis threshold, ISO instant/offset, tz-less `T`/space local date-time with 0-9 fraction digits
read as UTC, bare `yyyy-MM-dd` as midnight UTC) PLUS `MM/dd/yyyy` as midnight UTC (because `looksLikeTimestamp`
types such a column `timestamp`, and an uncast CSV column carries the raw string). Implemented with explicit
regexes + `Date.UTC`, never `Date.parse` on a tz-less string. Shared fixture
`shared-test-fixtures/chart-timestamp-parsing.json`: `[{input, epochMillis|null, backendParseInstant: bool}]`,
covering each accepted shape, a fraction of 1/3/6/9 digits, an offset, epoch seconds and millis, a leap day,
invalid dates (`2026-02-30`, `13/01/2026`), empty, whitespace, `"null"`, AND the backend's boundary shapes
(skeptic r1 CR4), each mirrored by the TS parser exactly as the backend reads it: whole-number decimal and
scientific numeric strings (`"1759276800.0"`, `"1.7592768E9"` -> epoch seconds); negative epochs on both sides of
the symmetric millis threshold (`"-9999999999"` seconds, `"-10000000000"` millis); surrounding whitespace (trimmed);
a non-whole decimal `"1759276800.5"` (epoch path rejects it, nothing else parses -> null); an ISO instant with a
fraction and `Z`; `T`-separated local date-time with and without seconds. The TS parser deliberately mirrors the
backend for every one of these; its single deliberate extension is `MM/dd/yyyy` (marked `backendParseInstant:
false` in the fixture, so the Scala spec skips it and asserts nothing about it). Jest asserts `parseChartInstant` for
every case; a new ScalaTest spec asserts `TimestampParsing.parseInstant(input).map(_.toEpochMilli)` equals
`epochMillis` for every case with `backendParseInstant: true` (and None where the fixture says null), so the
two parsers cannot drift silently. Labelled GUARD; mutation-proven (e.g. flip UTC to local in the TS parser and
show the Jest case red; change the fixture's expected millis and show the Scala case red), red output saved.

**D4 Time-axis data shape.** On a time axis every series' `data` is an array of objects
`{name: <raw x string>, value: [epochMillis, y | null]}` (scatter: `[epochMillis, y, size?]`), sorted ascending
by instant; ties keep first-seen order. `name` keeps the raw x so `chartClickSelection`'s `params.name` keying and
`filterRowsForSelection`'s string match keep working unchanged for line/bar/aggregate; the scatter branch of
`mapChartClickToSelection` uses `params.name` when it is a non-empty string, else today's `params.value[0]`
(so a non-time scatter is unchanged). A row whose x does not parse (null, `""`, garbage) is NOT plotted on a time
axis (it has no position); the count of dropped rows is not surfaced (follow-up candidate). The data option's
`xAxis` is `{type: "time"}` with no `data`. The legend stays `legend.data` as today.

**D5 Multi-series alignment + gaps (ruling 2).** The multi-series branch keeps one shared x list for every
series: category axis — first-seen order exactly as today; time axis — the distinct parsed instants sorted. Each
series' value at an x with no row for that series is `null` (was `0`), on BOTH axis types. A row whose y is
non-numeric stays absent from `lookup`, so it is also `null`. Lines break at `null` (ECharts' default
`connectNulls: false` — do not set it); a bar is omitted. Every series has the same length and order on both axis
types, so index-aligned consumers (`toPercentShares`, ECharts stacking) still line up. `toPercentShares` must read
`y` from a `{value:[t,y]}` item as well as from a bare number, and must write the share back in the same shape;
`null` contributes 0 to the sum and stays `null` in the output (a normalized bar with no value is omitted, not a
0% bar). Single-series and auto-detect branches keep NaN-y -> 0 (Non-Goal).

**D6 The appearance merge keeps a time axis.** In `buildChartOption`'s cartesian merge, when `dataOption.xAxis`
has `type: "time"` the merged `xAxis.type` is `"time"` (appearance keys — name, label/line styling, colours,
fonts — still apply) and no `data` key is carried. `useUTC: true` is set on the built option ONLY when the x axis
is time (ruling 3) — it changes nothing on a value/category axis but is kept scoped so non-time options stay
byte-identical. The x `axisLabel` gets no custom formatter: ECharts' adaptive time labels (ruling 4).

**D7a No-value tooltip text (ruling 2; skeptic r1 CR1).** ECharts 6.1 passes a gap's value to the tooltip
`valueFormatter` as `undefined` (category axis) or `null` (time axis, `[t, null]`); today's `formatChartNumber`
renders those as `"undefined"` and `"0"` — the latter re-creating the "reads as a real zero" defect. The tooltip
`valueFormatter` set by `appearanceToEChartsOption` becomes a wrapper that renders `null`/`undefined`/non-finite as
the no-value mark `"—"` (the app's convention: `UsageChart.tsx:69`, `DataGrid.tsx:410`) and otherwise delegates to `formatChartNumber`; the time-axis
formatter (D7) uses the same wrapper for y. `formatChartNumber` itself (used by axis labels and reference marks) is
unchanged. Side effect, stated against C2: a "vs" overlay's unmatched (null) points on a category axis now read
`—` instead of `undefined` in the tooltip — the option SHAPE is unchanged, only the formatter function's output for
a null. Red-first unit tests: the category-axis formatter output for a gap is `—` (not `0`/`undefined`); the
time-axis formatter with `[t, null]` likewise. D12 screenshots a hovered gap.

**D7 Tooltip on a time axis (ruling 4).** Item and axis tooltips on a time axis must show the instant formatted
in UTC — `yyyy-MM-dd` when every plotted x is midnight UTC, else `yyyy-MM-dd HH:mm` — and the y value through
`formatChartNumber` (the existing `valueFormatter` would receive the `[t, y]` array and must not render it).
Implement via a time-axis-only tooltip `formatter` (and the axis-pointer label formatter for the axis trigger)
set by the same pass that sets the axis; formatting helper `formatChartInstant(ms, withTime)` lives in
`chartTimeAxis.ts` (pure, UTC getters only). Hover/tooltip text is HTML-safe: ECharts string formatters
render HTML, so the series name and any user-derived text MUST be HTML-escaped — via a small local escape helper
or in the builder (which already imports echarts), never by importing echarts into `chartTimeAxis.ts` (it must
stay echarts-free for the HEL-512 lazy-chunk rule); a test pins a `<b>` series name rendering literally. The
date-only vs date-time choice is computed over the PRIMARY plotted instants only, so an overlay can never flip it.
`applyAxisTriggerTooltip` keeps switching to the axis trigger for >1 series; its `axisPointer.type` stays
`line`/`shadow`.

**D8 Aggregated Outputs (ruling 5).** Mechanism (skeptic r1 CR3): `GroupedAggregate` gains an optional
`groupBy?: string`, set by the two sites that already decorate the aggregate with `seriesName` (`ChartOutputPanel`
and `OutputPreviewPane`, from their aggregation spec), and `buildAggregateDataOption(aggregate, chartType,
fieldTypes, chartOptions)` receives `fieldTypes` (+ bar orientation for D2). Absent `groupBy` -> category axis as
today. `buildAggregateDataOption` gains the time branch: when `aggregate.groupBy` is a timestamp field (D2), each `aggregate.categories[i]` is parsed, unparseable ones (incl. the
`"null"` group) are dropped from the time plot, and points are `{name: category, value: [t, values[i]]}` sorted
by instant. The aggregate click selection (`params.name` = the category) and `groupHasNull` handling are unchanged.

**D9 "vs" overlay on a time axis (ruling 5).** `applyChartOverlay` accepts `xAxis.type === "time"` in addition to
`"category"`, with every other ignore rule unchanged (pie, scatter, multi-series primary, normalized or horizontal
bar, no match). Time alignment: build `Map<instantMillis, y>` from overlay points whose x parses (first occurrence
wins; null x never matches); for each primary point `{name, value:[t, _]}` emit `{name, value: [t, map.get(t) ??
null]}`; no match at all -> option unchanged. So an overlay point recorded as `2026-10-01` aligns to a primary
`2026-10-01T00:00:00Z`. `selectChartOverlay` (`history/chartOverlay.ts`) eligibility is unchanged. The overlay
series keeps its dashed muted style.

**D10 Reference marks.** No code change: they sit on the value axis. A test pins that a time-axis line with a
reference line and band still carries the carrier series and the widened `yAxis`, and the running-app check
includes it (D12).

**D11 Tests (red first).** Unit tests on the option builder (`chartDataOptions`/`buildChartOption`), each shown
RED on main before the fix with the output saved to the evidence dir:
(a) multi-series with a missing x -> `null` not `0` (category axis) — the ticket's named unit test;
(b) the same on a time axis; (c) irregular dates `2026-10-01, 2026-10-02, 2026-10-09` given unsorted -> `xAxis.type
"time"`, data sorted, values `[t, y]` with the right millis (proportional spacing is ECharts' own behaviour on a
time axis; the running-app check measures pixel x positions to show it); (d) a non-timestamp x (string-typed,
and `fieldTypes` absent) produces an option deep-equal to main's for line/bar/scatter/aggregate — snapshot the
main output in the test as the expectation (AC3); (e) horizontal bar with a timestamp x stays category;
(f) aggregate grouped by a timestamp; (g) overlay aligned by instant on a time axis and still ignored for
multi-series; (h) normalized stacking on a time axis sums to 100 per x and keeps `null`; (i) scatter time axis +
click mapping returns the raw x; (i2) auto-detect branch on a time axis; (l) gap tooltip text is `—` on category
and time axes (D7a); (j) tooltip formatter (UTC date vs date-time, HTML escaped); (k) tz-less
`2026-10-01T12:00` lands at 12:00 UTC regardless of `process.env.TZ` (run the suite case under a non-UTC TZ, e.g.
by a test that constructs dates only via the parser and asserts millis). Plus D3's GUARD.

**D12 Running-app check.** Dev servers on this worktree's ports (6737/9644). Create (and record ids up front, delete
by exact id at the end) a dataset/CSV source with irregular daily dates typed `timestamp` and two series where one
series misses some dates, a pipeline, and chart Outputs: multi-series line, single-series line with `config.compare`
set and a reference line + band, vertical bar, aggregated bar grouped by date, scatter; plus a stacked (not normalized)
multi-series bar on a time axis, plus a string-typed x chart for the unchanged case; hover a gap and screenshot
the tooltip (`—`). Screenshot light and dark at 1440 and 375 widths, incl. the "vs" overlay and reference marks
on a time axis; measure in the browser that x pixel gaps are proportional to day gaps and that a missing point
shows a gap (no 0 marker). Never touch the owner's real account; evidence into `.concertino/runs/HEL-1305/evidence/`,
moving any file the shared Playwright MCP writes into the main checkout's `.playwright-mcp/`.

**D13 Round-2 skeptic clarifications (non-blocking notes folded in).** (a) Escaping reuses the existing
`escapeHtml` in `heatmapHistogramOptions.ts` (move it to a shared echarts-free util if needed), no new helper.
(b) `OutputSheetPreviewCard.tsx` sits between the editor sheet and `OutputPreviewPane` and passes `fieldTypes`
(and the aggregate `groupBy`) through. (c) `buildDataOption`/`buildDataOptionCore` take `fieldTypes` and the bar
orientation (from `chartOptions`) as inputs. (d) On a time axis the multi-series lookup is keyed by INSTANT, not by
raw x string, so two spellings of one instant never produce a false gap; a point's `name` is the FIRST-SEEN raw x
string for that instant (click filtering matches it literally — documented limitation for mixed spellings).
(e) D7's custom formatter is needed for the UTC header; ECharts passes the tooltip `valueFormatter` the y value
only (probe skeptic-design-2), not `[t, y]`. (f) Unchanged-path deep-equal tests compare tooltip formatter
functions with `expect.any(Function)` (the D7a wrapper is a new function). (g) Optional extra parity cases:
lowercase `t`/`z`, a leading `+` on an epoch string, an offset without seconds — include each with the backend's
actual result.

## Risks / Trade-offs

- [ECharts stacking on a time axis may stack by value-dimension rather than index] -> D5 keeps identical sorted x
  lists, and the running-app check includes a stacked time-axis bar; if stacking misbehaves, stacked/normalized
  bars fall back to the category axis and that is recorded in files-modified.md and the PR body.
- [Bars on a time axis can be thin when points are sparse] -> ECharts sizes by the min interval; accepted, checked
  visually at 375.
- [Rows with unparseable x silently vanish from a time chart] -> documented (D4); follow-up candidate to surface.
- [Frontend/backend parser drift] -> D3 shared fixture GUARD.
- [A future `ChartRenderer` caller omits `fieldTypes`] -> it gets today's category behaviour (safe default); all three current callers are wired (D1).
- [Concurrent chart changes on main] -> re-sync with origin/main before PR; rerun the chart tests after the merge.

## Migration Plan

None (frontend rendering + tests; no config, schema, API or Flyway change). Rollback = revert.

## Planner Notes

- Self-approved: `fieldTypes` prop name; unparseable-x rows dropped from the time plot; `useUTC` scoped to time
  axes; tie order first-seen; scatter click prefers `params.name`.
- Follow-up candidates (to file at Delivery): single-series / auto-detect NaN-y still plots 0; surface a count of
  rows dropped for an unparseable timestamp x; an explicit axis-type override for string-typed date columns.
