## Context

Chart types are hand-enumerated in ~20 places (see `.concertino/runs/HEL-1311/evidence/premise-validation.md`):
`ChartType` (`utils/chartAppearance.ts:5`), `panel.ts:54`, `resolvePanelChartType.ts:5`, `OutputKindFields.tsx:38`,
`ChartAppearanceEditor.tsx:192`, `echartsCore.ts`, six `schemas/**` enums, `OutputConfigValidation.ChartTypes`,
`RequestValidation.ValidChartTypeValues`, `AssistantProposalToolSchemas:78`, MCP `proposal.ts:74` / `outputs.ts:73`.
"Never aggregates" is hard-coded as `=== "scatter"` in `chartOverlay.ts:47`, `ChartOutputPanel.tsx:88`,
`buildOutputConfig.ts:98`, `useChartClickHandler.ts:79`, `usePanelCardInspect.ts:49`, `OutputKindFields.tsx:104`,
`OutputConfigValidation.scala:113` and `OutputSummaryReducer.scala:116`. The Output editor never edits a chart's
`fieldMapping` today: `useOutputKindState.ts:81` holds it as read-only seed state (it is set by the aggregate-tail
path, MCP or the API). Owner rulings 2026-10-11 (all "A") are recorded in proposal.md.

## Goals / Non-Goals

**Goals:** one source per side for the chart-type set and the non-aggregating subset; a seam test pinning frontend,
backend, MCP and schemas to the same set; pure, echarts-free binning; per-type editor slots for the two new types.

**Non-Goals:** slot pickers for bar/line/pie/scatter; HEL-1397; click-to-select; changing the history summary.

## Decisions

**D1 Single chart-type source per side.** Frontend: `export const CHART_TYPES = [...] as const` and
`ChartType = (typeof CHART_TYPES)[number]` in `chartAppearance.ts`, plus `NON_AGGREGATING_CHART_TYPES` (scatter,
heatmap, histogram) and `isNonAggregatingChartType()`; `panel.ts`, `resolvePanelChartType.ts` and every `=== "scatter"`
"never aggregates" site above use them (scatter-specific DATA assembly, e.g. `chartDataOptions.ts:58`, stays
scatter-only). Backend: a `ChartTypes` object (`domain/panels`) with `All` and `NonAggregating`, used by
`OutputConfigValidation` (+ `KeysDoc`), `RequestValidation`, `AssistantProposalToolSchemas` and
`OutputSummaryReducer` (the reducer change only affects configs no write path can now create, so recorded history is
unchanged). MCP: one exported const used by `proposal.ts` and the `outputs.ts` doc. Alternative (generate from the
schemas) rejected: the existing drift check already compares schema enums; a seam test is cheaper and red-able.

**D2 Seam test.** Genuinely red first: a backend route test creating a `heatmap` and a `histogram` Output (201;
400 before the change) and a frontend test that `buildOutputConfig` for each new type emits that chartType with
`aggregation: null` (scatter-only rule before). GUARDS (labelled as such; already green before the change, so shown
red by recorded mutation): one backend spec, one frontend jest test and one helio-mcp test each WALK `schemas/**`,
collect every `chartType` property's `enum`, assert exactly 6 were found (zero/fewer discovered fails), and assert
each equals `ChartTypes.All` / `CHART_TYPES` / the MCP const (ignoring `null`). The mutation (drop one value from the
code-side set, and separately from one schema) and its red output are saved in the evidence dir.

**D3 Histogram = client-side bins over a bar series.** New pure module `utils/histogramBins.ts`
(`binHistogram(cells, binCount?) -> {bins:[{start,end,count}], skipped}`): numeric parse identical to the existing
`parseFloat` paths, blanks/NaN skipped, Sturges `ceil(log2 n)+1` clamped 1-50, equal width over [min,max], last bin
inclusive, single bin when min == max (this wins over a configured binCount), zero numeric values -> no bins. Rendered as a `bar` series (BarChart is already
registered) on a category axis labelled with formatted ranges, `barCategoryGap: 0`. Alternatives: ECharts' `ecStat`
transform (new dependency) and a value-axis custom series (more registration) rejected. Echarts-free so HEL-1306 and
tests can import it without the lazy chart chunk.

**D4 Heatmap = HeatmapChart + continuous VisualMap.** Register `HeatmapChart` and `VisualMapComponent` in
`echartsCore.ts` (with the per-entry comment the file requires). Data `[xIdx, yIdx, sum]` with both axes `category`
(x from `xAxis`, y from `series`), sums per cell, cells with no numeric value omitted. `visualMap` horizontal at the
bottom, `calculable: false` (no drag handles), range = plotted min..max. Colour uses NO new theme token (DESIGN.md
requires owner sign-off for one): `inRange: { color: [withAlpha(accent, 0.25), accent] }` (a two-stop ramp: ECharts' legend bar ignores an `opacity` channel, so
the bar would not match the cells) plus end labels `text: [max, min]` and `outOfRange: { color: [transparent] }` (ECharts draws a grey `inactiveColor` bar UNDER the gradient
otherwise, so the low stop blended over grey in the legend but over the card in the cells; an e2e pixel check compares legend ends with the lowest/highest cells), where `ChartThemeTokens` gains an `accent` field read
from the EXISTING `--app-accent` property (hex: `theme.css:188/262`, rewritten as hex by `appearance.ts:621`). NOT
`--app-accent-strong`: it is a `color-mix()` that `getComputedStyle` returns unresolved, zrender `parse()` rejects,
and VisualMapping falls back to black (skeptic round 2). The resolver passes `--app-accent` through only if it is hex/rgb[a] (a regex, keeping zrender out of the main bundle;
a test asserts zrender `parse` accepts every `inRange` colour), else the Jest/SSR fallback hex. Compact cards use a
smaller grid clearance and a thinner 10px bar (`HEATMAP_COMPACT_*`). The scale follows the user's accent in both themes; the 0.25
alpha floor keeps the lowest cells distinguishable from empty ones (the card surface), verified on the running app
with a pale accent (Yellow) in the light theme, raising the floor if the low end is not visible; visualMap label text `tokens.text`; empty cells are simply not drawn (the card surface
shows through). Tooltip `trigger: "item"`. Row/column order is first appearance in the loaded rows (as `allX` today).
Branches live in `buildDataOptionCore` before the pie branch and check `fieldMapping.xAxis` (and `series`/`yAxis`
for heatmap) explicitly, never the column-0 fallback of `resolveDataColumns`; a histogram with no `xAxis` renders
empty. `binCount` reaches `buildDataOption` through a new histogram-options parameter alongside the scatter one
(`buildChartOption.ts:121` passes only `chartOptions?.scatter` today). Tooltip `valueFormatter` checked on the running
app. Merge change (ground truth: `buildChartOption.ts:173`
builds `yAxis` only from `defaultOption`/`appearanceOption`, and the appearance yAxis forces `type: "value"` + a number
formatter): for heatmap, `buildChartOption` SHALL take `yAxis` from the data option (category, row values), keeping
only the appearance axis's label/name styling (font/colour), never its `type` or number formatter; `useAggregate` stays
bar/line/pie only. The same post-pass at `buildChartOption.ts:304` must not re-impose a value type.

**D5 Skipped-values note.** `buildDataOption` cannot render DOM, so the histogram skipped count is computed by the
renderer path (`ChartRenderer`, via `binHistogram`) and shown in the existing note slot used for the HEL-1358
truncation note (both notes may show; skipped note second). Copy: "3 non-numeric values skipped."; on narrow cards
(the HEL-1398 container query) it stacks under the short truncation note, verified at 375px.

**D6 No click, no overlay.** ECharts 6.1 defaults element cursors to pointer (zrender `Displayable`), so skipping
`withPointerCursor` is not enough. Histogram: `withPointerCursor` sets `cursor: "default"` on its bar series (bar honours
it). Heatmap: its view does not read `cursor` (skeptic round 1), and `silent: true` would kill the item tooltip, so the
chart host overrides the canvas cursor: `useHeatmapDefaultCursor` returns an `onChartReady` callback that attaches a
zrender `mousemove` handler (`setCursorStyle("default")`) to each chart instance as it is created and reads the current
type from a ref (an effect-registered handler was left on a disposed instance, observed live). HeatmapView confirmed not
to read `cursor`. Test 4.7 asserts the hover cursor seen in the running app (Playwright, computed canvas `cursor`), not only the
option. `mapChartClickToSelection` is the single gate returning no selection for them (a hook-level guard in
`useChartClickHandler` was dropped as redundant; the click is still swallowed). `chartCompareBlocker` gains reason `"chartType"`, checked
FIRST (a heatmap always has `series` set, and the note must name the chart type); `selectChartOverlay`/
`applyChartOverlay` return no overlay for these types. `HistoryChart.tsx` renders a muted note
("A history chart isn't drawn for heatmap or histogram Outputs.") for them.

**D7 Editor.** `useOutputKindState` gains a setter for `chartFieldMapping` (dirty/save/cancel as other fields).
`ChartKindFields` shows, for heatmap: Columns/Rows/Value pickers (Value numeric-only); for histogram: Field
(numeric-only); both replace the aggregation fields with a hint like scatter's. Numeric-only pickers use ONE predicate: the server's chart `yAxis` eligibility (`SlotEligibility.Numeric` =
integer/float) as returned by capabilities-at-node (`capabilities.chart` eligible columns for `yAxis`), never the
frontend `NUMERIC_TYPES` sets. A stored mapping naming a column outside that list stays selected, labelled
"<name> (not numeric)", and is saved unchanged unless the author changes it (the renderer skips its non-numeric
cells and shows the skipped note). With no numeric column the picker is disabled with the hint "No numeric columns
here. Cast a column to a number in the pipeline to use it." (string-typed CSV columns need a cast step). The bin-count control (Automatic or 2-100, shared `TextField`, 44px on touch) is `outputEditor/HistogramBinCountField.tsx`,
not `ChartDisplayFields`; an invalid draft is never committed and BLOCKS Save (`binCountInvalid` in the kind state). `ChartTypeOptionsMap` gains `histogram?: {binCount?}`;
`readChartConfig` drops out-of-range binCount (renders Automatic). The compare note becomes parameterised by chart
type ("The vs overlay doesn't show for histogram charts."); the general Compare help text and its four snapshot
occurrences are updated intentionally. Aggregate-tail creation is disabled for these types.
Verify whether `ChartAppearanceEditor`'s chart-type radio is reachable (spec says the detail modal shows none); add the
types only if it is, and say which in files-modified.

**D8b Schema descriptions and error strings.** The `config.description` text in the three Output request schemas
("chartType is bar|line|pie|scatter", "never on a scatter chart") and `RequestValidation.scala:89`'s literal list are
regenerated from / updated to the new set, and the descriptions mention the binCount rule.

**D8 Backend binCount validation.** In `OutputConfigValidation.validate`, judged only when
`chartOptions.histogram.binCount` differs from stored (tolerance rule); integer 2-100 or null/absent, else 400 naming
`binCount`. `chartOptions` stays otherwise free-form.

## Risks / Trade-offs

- [VisualMap legend crowds compact cards / 375px] -> horizontal, bottom, compact-aware sizing; verified on the running
  app in both themes at desktop and 375px with screenshots in the run evidence dir.
- [Switching heatmap -> bar keeps `series`, giving a multi-series bar] -> acceptable and reversible; noted in the hint.
- [Histogram over 200 rows is a sample] -> owner ruling Q3=A; truncation note shown; HEL-1397 owns the real answer.
- [Bundle growth] -> measure `npm run build` chunk sizes before/after; report in the PR.

## Migration Plan

None: additive enum values, no DB change. Rollback is a revert; stored heatmap/histogram configs would then render
as the `line` fallback in `resolvePanelChartType`.

## Planner Notes

- Self-approved: editor slot pickers for the two new types (the owner's Q1 answer assumed the editor relabels slots;
  in fact it had no chart slot pickers, so pickers for these two types are the minimal way to honour it).
- Self-approved: History view note instead of drawing from the 2-column summary (consistent with Q4=A).
- Seams for HEL-1306: `echartsCore.ts` registration list; `applyChartTypeOptions`; histogram's category axis means a
  value-based markLine there needs bin-index mapping; `NON_AGGREGATING_CHART_TYPES` style per-type capability sets.
- Design-gate r3 notes for the executor: the aggregation rejection message (`OutputConfigValidation.scala:115`) names
  the actual chart type; the colour-parse check in `resolveChartTheme` must not pull echarts into the main bundle
  (import `zrender/lib/tool/color` directly or use an equivalent hex/rgb regex; confirm in the bundle note); confirm a
  hovered heatmap cell stays visibly distinct on the running app.
- Follow-up to file: heatmap-cell / histogram-bin click-to-select and cross-filter (Q4=A).
