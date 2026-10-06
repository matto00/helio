## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed the revised proposal.md, design.md (D1–D13), tasks.md and the four spec deltas (output-history-scrubber, chart-history-overlay, output-history-api, mcp-output-tools). I checked them against the live tree at HEAD 3962e6eb2c09a009259c8f75f2cf1aa4c1fe3526; only the change directory is untracked. Owner rulings Q1–Q4 (C1–C4), epic D1–D10 and the driver constraints were treated as binding and not re-litigated.

### What I verified (with evidence)

**Round-1 change requests: re-checked against the tree, not just the wording**

1. **CR1 (mirror what the dashboard plots): resolved.**
   - `usePanelData` hard-codes `chartAggregate: null` (usePanelData.ts:46, 240, 269), and the PanelContent chart branch plots `cfg.fieldMapping` rows.
   - `OutputSummaryReducer.series` stores `rows` mode with `x=fieldMapping.xAxis`, `y=fieldMapping.yAxis` only when aggregation is unset. Otherwise it stores `grouped` (OutputSummaryReducer.scala:105-117).
   - D9 now requires `mode==="rows"` plus x/y equality with `fieldMapping`, and refuses an aggregated chart Output. That matches the reducer exactly.
   - The spec scenario "Aggregated chart Output gets no dashboard overlay" and the task 2.3 test are present.
   - The editor-preview grouping divergence is recorded as a found issue.
2. **CR2 (normalized and horizontal bars): resolved.**
   - `BarChartOptions.stacking` and `orientation` exist as named (types/panel.ts:98-105), and `applyBar` transforms on exactly those values (utils/chartTypeOptions.ts:79-106).
   - D8, the spec ("Normalized and horizontal bars ignore overlay") and task 3.1 cover both.
   - The insertion point (after `applyChartTypeOptions`, before `applyAxisTriggerTooltip`/`applyHoverEmphasis`) matches buildChartOption.ts:173-202.
3. **CR3 (schema contract and proposal contradiction): resolved.**
   - Both schemas already define `$defs.seriesSummary`, and `resolvedPoint` is `additionalProperties:false` with required `capturedAt,rowCount,value`. Task 1.2's edit is therefore well-formed.
   - The only consumers of the schema files are the three route specs named in task 1.3 plus `helio-mcp/src/types.ts` (grep).
   - Existing tests assert individual fields, never the whole resolved-point object, so an added `series` breaks none of them (OutputHistoryRoutesSpec.scala:159-308, OutputHistoryPublicRoutesSpec.scala:110).
   - proposal.md now lists the backend, schema and MCP changes and both Modified Capabilities.
   - `ResolvedHistoryPoint` has a single constructor site, `OutputHistoryService.resolve` (OutputHistoryService.scala:127), and is serialized only in OutputHistoryProtocol.scala:94. The change surface is as claimed.
4. **CR4 (MCP): resolved.**
   - D11 chooses option (a).
   - The MODIFIED `get_output_history` requirement is a faithful copy of `openspec/specs/mcp-output-tools/spec.md`. A diff shows only the three intended `series` sentences changed, and the "previous run" prohibition is kept.
   - The handler (outputsHandlers.ts:115-124) and `types.ts:259-263` are the right sites.
5. **CR5 (chart `compare` reachability): adequately stated.**
   - proposal.md "What Changes" and D12 both say the overlay is reachable only by API/MCP PATCH. They say the picker is a non-goal and the follow-up is noted, not filed, with the driver told.
   - I confirmed the premise is safe. `compare` validation is kind-agnostic (OutputCompare.scala:45-52, OutputService.scala:461, PipelineService.scala:679). `OutputService.mergeConfig` is a shallow merge that keeps absent keys (OutputService.scala:464-475).
   - So a PATCH-set chart `compare` survives a later editor save, whose chart branch never writes `compare`. The feature is reachable and durable through the API.
   - Polish notes are below.
6. **CR6 (`auto-run`): resolved.**
   - D4, the spec and task 2.4 label `auto-run` and sentence-case unknown values.
   - RunHistoryModal's map is typed to `"manual"|"scheduled"|"external"` (RunHistoryModal.tsx:53; pipelineStep.ts:740), so the extraction is needed.
7. **CR7 (payload-tier mechanism): resolved.**
   - D13 and task 5.1 specify `setUserTierForTest` via psql, by exact id, asserting 1 row, on a fresh user.
   - `users.tier` exists with CHECK `free|beta|owner` (V88__user_tier.sql:13).
   - The payload writer looks the owner's tier up per write (NodePayloadHistoryRepository.scala:39), so no session-cached tier defeats the update.
   - It follows `historySeed.ts`'s existing loud-fail psql pattern.
8. **CR8 (Change column mechanism): resolved.**
   - D7 specifies `TableRenderer.leadingColumns?: ColumnDef[]`, rendered through `ColumnDef.render(row)` (DataGrid.tsx:34). It is excluded from sort, filter, pin, column order, width and persistence, and never mutates rows.
   - The spec scenario "Highlight survives a sort" asserts that the column is neither sortable nor filterable.

**The design as a whole: new findings**

- **The public dashboard path has no `rowsComplete` signal (CR1 below).**
  - D9 sources `rowsComplete` from "the existing `rowsTruncated` prop". `PublicDashboardViewerPage.tsx:114-127` renders `<PanelContent>` without `rowsTruncated`.
  - `usePublicPanelData` fetches one page of 200 with no "load more" (usePublicPanelData.ts:32; fetch at `0, 200`), but does expose `total`.
  - So on a public dashboard `rowsTruncated` is always `undefined`, `rowsComplete` evaluates true, and a >200-row chart would draw the overlay against a truncated primary.
  - That violates the delta's own requirement ("omitted when the panel's loaded rows are not the Output's complete row set"). It also makes the public render diverge from the authenticated render of the same panel, where `usePanelData` does supply `hasMore` and the overlay is hidden.
  - The other three call sites (PanelCard.tsx:336, PanelFullscreenOverlay.tsx:224, PanelDetailModal.tsx:503) do pass `rowsTruncated`.
- **Other new decisions are sound against the tree:**
  - The `useOutputHistory` signature (`enabled`, `expectedCompare`) matches D9's use (useOutputHistory.ts:27-35).
  - The `MetricOutputPanel` child-component precedent is real (PanelContent.tsx:300-312).
  - The `filterActive` expression matches PanelContent.tsx:310.
  - `compareLabel` returns `"custom"` only for non-day, non-hour custom durations (metricHistoryView.ts:78-86), so D9's date-label fallback is well-defined.
  - The payload response carries `rows` and `rowCount` (output-history-payload-response.schema.json).
  - A native range input has in-repo precedent (PreferencesEditor, AppearanceEditor, ChartDisplayFields).
  - `fetchOutputHistory` currently takes no options (outputHistoryService.ts:46), so D2's `{limit}` is additive.

### Verdict: REFUTE

### Change Requests

1. **D9 / chart-history-overlay spec / task 3.2: specify `rowsComplete` for the public dashboard path.**
   - PublicDashboardViewerPage.tsx:114-127 passes no `rowsTruncated`, and `usePublicPanelData` loads a single 200-row page with `total` available. As written, D9 treats every public chart as complete, so a >200-row public chart gets an overlay its authenticated twin correctly omits.
   - Name the public source, for example `PublicDashboardViewerPage` passing `rowsTruncated={panelData.total > (panelData.rawRows?.length ?? 0)}`, or `usePublicPanelData` returning a `rowsTruncated`.
   - Note that this touches a file outside the ticket's Touches list.
   - Add a test: a public chart panel whose `total` exceeds its loaded rows, with a compare and a matching baseline, renders no overlay.

### Non-blocking notes

- **CR5 placement.** D12 and proposal.md state the non-goal clearly, but design.md's Goals/Non-Goals list does not include "chart Compare picker". No task ensures the noted follow-up reaches the PR body or the driver. Add one line to Non-Goals and a 5.x item ("PR body / final report lists the chart Compare picker follow-up") so the note cannot be lost between planning and delivery.
- **RunHistoryModal.** "Non-Goals: RunHistoryModal changes" conflicts mildly with D4/task 2.4, which route RunHistoryModal through the new helper and so change its `auto-run` badge from empty to "Auto-run". That is a desirable fix, but say so: it is a small behaviour change, and `run-history-modal__trigger--auto-run` gets no modifier style.
- **History view chart appearance.** D5 says to render with "the Output's chartType/appearance/chartOptions", but appearance belongs to the panel, not the Output. Follow the `OutputPreviewPane` precedent (`{...defaultPanelAppearance, chart: {...defaultChartAppearance, chartType}}`, OutputPreviewPane.tsx:104-108) with `chartType` from `readChartConfig`.
- **`primarySeriesCount`.** The `selectChartOverlay` parameter is not knowable before `buildChartOption` runs. D8's own single-series check already covers it, so drop the parameter or derive it from `fieldMapping`.
- **x alignment.** Stored rows-mode x strings are truncated at 256 chars (OutputSummaryReducer.scala:19,123), and a null x stores as JSON null (`String(null)` = "null"), while the dashboard renders it as "". Such categories silently get a null overlay value. This is acceptable, but worth one unit test so it stays a known behaviour.
- **Visual (final gate).** A single-series bar with a side-by-side overlay bar at 0.45 opacity halves bar widths, and `z` has no effect for side-by-side bars. Judge it in both themes.
