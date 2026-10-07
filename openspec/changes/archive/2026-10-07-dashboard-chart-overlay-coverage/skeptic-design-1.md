## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD a606a9833910e36ad544e6aff6e4b87049245559 (branch has no commits beyond main; change dir is untracked).
Static verification only (lane rule: no shared Playwright browser at this gate).

### What I verified (with evidence)

- **Owner ruling is real.** `.concertino/runs/HEL-1351/events.jsonl` (main checkout) line 5:
  `escalation.answered`, `sub_answers: ["defer-standalone","client-aggregate"]`, `answer_source: human`. The artifacts
  match it: item 2 is deferred (proposal Non-goals, C1), item 1 groups client-side (D2, C2).
- **Design context claims hold.**
  - `usePanelData.ts:46,240,269` — `chartAggregate: null` on every path; nothing on the dashboard applies aggregation.
  - `OutputPreviewPane.tsx:84-88` — the preview groups records with `groupAndAggregate` when `chartType !== "scatter"` and groupBy/yField/agg are set (`isAggFn`).
  - `OutputSummaryReducer.scala:38-41,108-121` — the server stores a `grouped` series under the same condition (`chartType` defaults to `"line"`, `!= "scatter"`), keys are `String`-ified and sorted, `getOrElse(0.0)`.
  - `chartOverlay.ts:93` — `selectChartOverlay` accepts only `series.mode === "rows"`.
  - `buildChartOption.ts` (hideLegendForMeasuredSize) — the legend is hidden whenever `effectiveCompact`.
  - `PanelDetailModal.tsx:66` — `chartType: panel.appearance.chart?.chartType ?? "line"`.
- **Record rows (D2).** `usePanelData.ts` stringifies `null` to `""` in `rawRows`, while `groupAndAggregate` uses `String(row[groupBy])` (gives `"null"`). Grouping from records is therefore correct. `PanelCardBody` (also used by `MobilePanelStack`) already passes `paginationRows` (PanelCard.tsx:328). `PublicDashboardViewerPage.tsx:122` passes them too. `PanelFullscreenOverlay` and `PanelDetailModal` do not. The D2 call-site list is accurate.
- **Overlay alignment (D4).** `buildAggregateDataOption` (chartDataOptions.ts:184-203) emits a category x axis with a single series. `applyChartOverlay` aligns by `String(x)`. That works for grouped categories.
- **Picker copy (D5).** `ChartCompareField.tsx:11,13` holds the "aggregated Outputs" help and note text. `chartCompareBlocker` returns `"aggregated"` first (chartOverlay.ts:53). The planned change targets the right code.
- **Click path (D3).** `useChartClickHandler.ts:68` resolves `chartType` from `appearance?.chart` and calls `mapChartClickToSelection`. That function keys `dimension` on `headers[xCol]`, with `xCol` taken from `fieldMapping.xAxis` or column 0 (chartClickSelection.ts:93-95). D3 correctly finds that this is wrong for an aggregate.
- **Inspect path, which the design misses (see CR1).** `PanelCard.handleDataPointSelect` opens Inspect on every chart click (`setIsInspectOpen(true)`). `PanelInspectView.tsx:83-91` filters with `filterRowsForSelection(..., chartInspectConfig.fieldMapping, chartInspectConfig.chartType, ...)`, which matches on `fieldMapping.xAxis` (or column 0) and `fieldMapping.series` (chartClickSelection.ts:121-145). Inspect's "Filter dashboard" is the **only** writer of the cross-filter (PanelInspectView.tsx:70-79).
- **Inspect chart type, which D7 misses (see CR2).** `PanelCard.tsx:458-466`: `chartInspectConfig.chartType = resolveChartType(panel.appearance.chart)`, which returns `"line"` when unset (chartAppearance.ts:119-120). This object feeds both the grid Inspect and the fullscreen Inspect (PanelCard.tsx:750,806).
- **Existing specs that contradict D7 (see CR3).**
  - `openspec/specs/chart-type-selector/spec.md:39-44` says: "Default chart type is line when none is stored … selector MUST default to `"line"`", with the scenario "opened in the detail modal → shows line".
  - `openspec/specs/echarts-chart-panel/spec.md:95` says: "(`appearance.chart.chartType`, default `line`)".
  - `openspec/specs/panel-appearance-settings/spec.md:197-199` says: "absent-chartType-renders-as-line fallback".
  - The change dir carries only a `chart-history-overlay` delta.
- **Aggregation spec already exists.** `echarts-chart-panel/spec.md:9,44-50` already requires panels to render `aggregation`. Item 1 restores conformance and contradicts nothing.
- **AC coverage.** Items 1, 3 and 4 are fixed and item 2 is deferred to HEL-1358 after escalation (AC 1 and 2). Tasks 4.5 and 4.6 plan the both-theme running-app check (AC 3). No placeholders, TODOs or TBDs.

### Verdict: REFUTE

### Change Requests

1. **Plan the Inspect view for aggregated charts (D3, tasks, spec).** D3 says click-select needs only a `dimension` fix and that cross-filtering needs "no extra work". That is not true. Every click on a chart opens `PanelInspectView`, and its rows come from `filterRowsForSelection` keyed on `fieldMapping.xAxis` and `fieldMapping.series` (chartClickSelection.ts:121-145). For an aggregated chart, the click value is a `groupBy` category, so Inspect will show "Showing rows for region: west" over an empty or wrong grid. Its "Filter dashboard" action is the only way the selection becomes a cross-filter.
   - Revise D3 so an aggregated chart's Inspect filters on `aggregation.groupBy === value`, with no series column. The rule should come from the same `chartAggregationSpec`, threaded through `ChartInspectConfig` (PanelCard.tsx:458) or an equivalent.
   - Add a task for it.
   - Add a spec scenario: clicking `west` on the aggregated bar → Inspect lists exactly the `region = west` rows.
   - Extend task 4.3 to assert this.
2. **Thread D7's chart-type resolution into `chartInspectConfig` (D7, task 3.x).** `PanelCard.tsx:462` still resolves `resolveChartType(panel.appearance.chart)`, which falls back to `line`. After D7, a panel with no stored type over a `scatter` Output renders scatter, while the Inspect config (grid and fullscreen) filters with bar/line string equality instead of the scatter numeric match (chartClickSelection.ts:131-140). Make one shared resolver: stored panel `chartType`, else the Output's `config.chartType`, else `line`. Use it for `ChartOutputPanel`, `chartInspectConfig` and `buildInitialChart`, and list `PanelCard.tsx` in the proposal's Impact.
3. **Add the missing spec deltas for D7.** The change will contradict these live specs, and only `chart-history-overlay` is modified:
   - `chart-type-selector/spec.md` "Default chart type is line when none is stored" (the selector MUST default to `line` in the detail modal). Task 3.2 makes it pre-fill the Output's type.
   - `echarts-chart-panel/spec.md:95` "(`appearance.chart.chartType`, default `line`)".
   - `panel-appearance-settings/spec.md:197-199`'s "absent-chartType-renders-as-line fallback" wording, in the explicit-null scenario.

   Add MODIFIED deltas, or wording that defers to the new "Dashboard chart type defaults to the Output's chartType" requirement, so archiving the change does not leave contradictory requirements.
4. **Resolve D6's ambiguity about explicit legend settings.** D6 says to "keep the legend shown … top-anchored". It does not say what happens when the panel's appearance explicitly sets `chart.legend.show: false`, or sets a non-top `legend.position` (`appearanceToEChartsOption` honours both, chartAppearance.ts `legend: {show: chart.legend.show, ...legendPositionProps(...)}`). An implementer could read D6 either way: force the legend on, or only lift the compact-mode hide. State which, and add a test case (task 4.4) for the explicit-hidden case.

### Non-blocking notes

- An aggregated primary series has no `name` (`buildAggregateDataOption` emits `{type, data}` only). The compact legend D6 shows would therefore list only "vs 7d", and tooltips show an unnamed primary. Consider naming the primary series (for example `agg(yField)`) so the legend reads as a comparison.
- D7 plus task 3.2: opening and saving the appearance editor for any reason, such as changing colours, now freezes `chartType` to the Output's current type as an explicit override. A later change to the Output's chartType will then no longer reach that panel. This is still an improvement over freezing to `line`. Consider writing `chartType` only when the author changed it, or record the trade-off.
- The server truncates grouped category strings longer than `MaxXStringChars` (OutputSummaryReducer.scala `truncate`), so a very long category will silently not align with the client category. This is harmless (no match means no overlay point) but worth a code comment in D4.
- `OutputEditorSheet.compareBlockerInput` (lines 314-318) nulls `aggregation` for scatter. Once D1 gates on `chartType`, that workaround becomes redundant. It can be removed alongside task 1.7.
