## Context

Verified on main a606a9833. `usePanelData` returns `chartAggregate: null` always (HEL-909 comment claims "the Output
owns aggregation" — nothing applies it on the dashboard path), so `buildChartOption` plots raw rows. The editor preview
(`OutputPreviewPane`) groups its record rows with `utils/aggregate.groupAndAggregate` when `chartType !== "scatter"` and
groupBy/yField/agg are all set. The server (`OutputSummaryReducer.series`) stores a `mode:"grouped"` series under the
same condition (Output `config.chartType != "scatter"`), using a port of the same function (String keys, sorted, `?? 0`).
`selectChartOverlay` accepts only `rows`-mode series. `buildChartOption` hides the legend whenever `effectiveCompact`.
`HistoryChart` uses `config.chartType`; dashboard panels use `appearance.chart?.chartType` falling back to
`defaultChartAppearance` (`line`). `PanelDetailModal.buildInitialChart` fills `chartType ?? "line"`.

Owner decisions (escalation answered 2026-10-07): item 2 → defer to HEL-1358; item 1 → client-aggregate.

## Goals / Non-Goals

**Goals:** items 1, 3, 4 fixed; item 2 explicitly deferred; HEL-1350 note/help copy consistent with the new rules.
**Non-Goals:** >200-row overlay (HEL-1358); summary-series rendering; backend changes.

## Decisions

**D1 — One aggregation spec, three readers.** Add `chartAggregationSpec(config)` in `history/chartOverlay.ts` (or a
sibling module) returning `{groupBy, agg, yField} | null`: non-null iff `config.chartType !== "scatter"` and all three
are non-empty strings and `agg` passes `isAggFn`. The editor preview, the dashboard aggregate, the overlay selector and
the Compare blocker all use it, so their notion of "aggregated" cannot drift. The preview keeps passing its own live
editor state through the same helper (build a config-shaped object or add a field-level variant — no second rule).

**D2 — Dashboard aggregate from record rows.** `ChartOutputPanel` receives the loaded **record** rows (`paginationRows`,
cross-filter-narrowed the same way `filteredPaginationRows` already is in `OutputPanelContent`) and computes
`groupAndAggregate(records, spec.groupBy, spec.agg, spec.yField)` when D1's spec is non-null, passing it as
`chartAggregate`. Records, not `rawRows`: `usePanelData` stringifies `null` to `""`, which would group differently from
both the preview and the server (`String(null)` = `"null"`). Every `PanelContent` call site that can render a chart
Output must supply record rows: `PanelCard` and `PublicDashboardViewerPage` already do; `PanelFullscreenOverlay` and
`PanelDetailModal` must be threaded. The existing always-null `chartAggregate` prop chain is replaced by this local
computation (delete the dead prop where it becomes unused; keep `usePanelData`'s field only if still read).
Truncated rows: the aggregate is still drawn from the loaded rows (same partial-data behaviour raw charts already have,
tracked by HEL-1358) and never overlaid (C1).

**D3 — Click-select and Inspect on aggregated charts.** Every chart click goes through `useChartClickHandler` →
`mapChartClickToSelection` (dimension = `headers[xCol]` from `fieldMapping.xAxis` or column 0) and then opens
`PanelInspectView`, whose rows come from `filterRowsForSelection(..., chartInspectConfig.fieldMapping, chartType, ...)`
(matches `fieldMapping.xAxis`/`series`). Inspect's "Filter dashboard" is the only cross-filter writer. For an
aggregate-rendered bar/line/pie (resolved type, D7 — a panel whose resolved type is scatter renders raw rows and keeps
xAxis keying), the selection's `dimension` SHALL be `spec.groupBy`, its `value` the clicked
category, its `series` the primary series name (D4a), and Inspect SHALL list exactly the loaded rows whose
`String(row[groupBy])` equals the value (no series column) — the same keying `groupAndAggregate` used; Inspect's aggregate branch therefore filters the
loaded **record** rows (thread into `PanelInspectView` the same cross-filter-narrowed record set the chart grouped over, never raw
`paginationEntry.rows`), not the null→`""` stringified `rawRows`.
Edge (comment + test): "Filter dashboard" on the `"null"` group writes value `"null"`, which
`filterRecordRowsByDimension` (null→`""`) will not match on sibling panels — accepted, documented. The click handler
(`useChartClickHandler`, inside `ChartPanel`) receives the aggregation spec from `ChartOutputPanel` through
`ChartRenderer`/`ChartPanel` props, never from `ChartInspectConfig`. The spec
reaches both Inspect mounts via `ChartInspectConfig` (built in `PanelCard.tsx` ~458, used by grid and fullscreen Inspect) carrying
`chartAggregationSpec(outputConfig)` and the D7-resolved chart type. Cross-filter targeting of an aggregated panel
narrows records before grouping (D2) — only when it is a cross-filter target at all
(`isPanelFilterableByDimension` matches `fieldMapping` values), unchanged by this ticket.

**D4 — Grouped overlay.** `selectChartOverlay`: when D1's spec is non-null, require `series.mode === "grouped"`,
`series.x === groupBy`, `series.y === yField`, `(series.agg ?? null) === agg`, not downsampled; otherwise the existing
`rows`-mode rules unchanged. Completeness/filter rules (C1) unchanged for both modes. Grouped categories are unique by
construction; the repeated-x check still applies to `rows` mode only. Alignment stays `applyChartOverlay`'s
`String(x)` match against the aggregate's categories (identical keying to the server's). Known harmless gap (code
comment): the server truncates category strings over `MaxXStringChars`, so such a category simply gets no overlay point.

**D4a — Name the aggregated primary series.** `buildAggregateDataOption` names its series `<agg>(<yField>)` (e.g.
`sum(amount)`), so a shown legend reads "sum(amount) / vs 7d" and the tooltip names the primary.

**D5 — Compare picker copy.** `chartCompareBlocker`: drop `"aggregated"`. For an aggregated config (D1 non-null) the
mapping check uses groupBy/yField (already guaranteed) instead of `fieldMapping.xAxis/yAxis`, and `fieldMapping.series`
does not block (aggregate rendering is single-series); horizontal/normalized still block. Remove "aggregated Outputs"
from `CHART_COMPARE_HELP` and its note entry. Keep "Outputs with more than 200 rows" (still true; HEL-1358).

**D6 — Compact legend.** In `buildChartOption`, when `effectiveCompact` and the overlay was actually applied (series
count grew), the compact-mode legend hide is NOT applied; the legend then follows the panel's own appearance exactly as
a non-compact chart does — an explicitly stored `chart.legend.show: false` stays hidden, a stored `legend.position` is
honoured — with compact sizing (`type: "scroll"`, item size and font `COMPACT_AXIS_LABEL_FONT_SIZE`) and the compact
grid inset on the legend's side enlarged just enough to clear it. Compact charts without an applied overlay keep
today's hidden legend (no regression to F-026/F-028 layouts). Pie is unaffected (no overlay).

**D7 — Chart-type default, one resolver.** Add one resolver `resolvePanelChartType(appearanceChart, outputConfig)`:
stored panel `chart.chartType`, else the Output's `readChartConfig(config).chartType`, else `line`. It is the only
source for: the appearance `ChartOutputPanel` renders with (rest of chart appearance unchanged, default when absent);
`chartInspectConfig.chartType` in `PanelCard.tsx` (replacing `resolveChartType(panel.appearance.chart)`), so click
mapping and Inspect filtering (e.g. scatter numeric matching) agree with what is drawn; and
nothing else. `PanelDetailModal` is NOT changed: its
chart section has been hidden since HEL-909 (`showChartSection={false}` at PanelDetailModal.tsx:540 is the only
`AppearanceEditor` mount) and its save payload (`{background, color, transparency}` + title) never writes `chart`, so
no save path can freeze an inherited type; `buildInitialChart` stays as is (inert). An explicitly stored type still
wins. Render-time only — rendering never writes appearance.

## Risks / Trade-offs

- Aggregating 200 truncated rows shows partial totals — same limitation raw charts have today; owner deferred to
  HEL-1358. Mitigated for the overlay by C1.
- D7 changes how existing placement panels with no stored chartType render (line → Output's type). Intended: it is what
  the editor preview and History already show.
- D6 consumes ~16px on a compact canvas; only when an overlay is present and the panel's legend is enabled.
- Panels whose stored chart came from a partial appearance PATCH may already store `chartType: "line"` explicitly
  (merge over `ChartAppearance.Default`); D7 treats that as a deliberate override and does not guess otherwise.

## Planner Notes

- Design gate r2 REFUTE addressed: D7 no longer touches the detail modal (chart section unrendered since HEL-909);
  `chart-type-selector` delta dropped — that spec has described an unrendered selector since HEL-909 (stale,
  out of scope); Inspect uses record rows; click-handler wiring stated. The picker scenario keeps its archived name
  "Aggregated chart Output gets a specific note" (the validator requires existing scenario names) with inverted body.
- Design gate r1 REFUTE addressed: Inspect path (D3), shared chart-type resolver (D7), D7 spec deltas, D6 legend
  semantics; non-blocking notes adopted (D4a naming, truncation comment, scatter workaround removal in task 1.7).
- Self-approved: D1–D7 (frontend-only, no API/contract change). Escalated and answered: items 1 and 2.
- C1/C2 are standing constraints (tasks.md).
