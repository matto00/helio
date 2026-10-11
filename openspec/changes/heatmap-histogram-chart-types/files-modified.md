# Files modified (HEL-1311)

## Backend
- `backend/src/main/scala/com/helio/domain/panels/ChartTypes.scala` — new: the single backend chart-type set (`All`, `NonAggregating`).
- `backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala` — chartType from `ChartTypes`, non-aggregating rule names the actual type, `chartOptions.histogram.binCount` validation (2-100 whole, tolerance rule), `KeysDoc` text.
- `backend/src/main/scala/com/helio/api/http/RequestValidation.scala` — chartType set and error string from `ChartTypes`.
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` — chartType enum from `ChartTypes.All`.
- `backend/src/main/scala/com/helio/domain/history/OutputSummaryReducer.scala` — grouped-series rule uses `ChartTypes.NonAggregating`.
- `backend/src/test/scala/com/helio/services/pipelines/OutputHeatmapHistogramSpec.scala` — new route spec (201 / aggregation 400 / binCount 400, tolerance); RED first.
- `backend/src/test/scala/com/helio/domain/panels/ChartTypesSchemaGuardSpec.scala` — new GUARD: walks `schemas/**`, exactly 6 chartType enums, each == `ChartTypes.All`.
- `backend/src/test/scala/com/helio/services/pipelines/OutputConfigValidationSpec.scala` — heatmap/histogram accepted; aggregation rejected naming the type.

## Schemas and MCP
- `schemas/{outputs/create-output-request,outputs/update-output-request,pipelines/create-pipeline-transactional-output-request,dashboards/dashboard-proposal,panels/panel-appearance,panels/panel-appearance-patch}.schema.json` — six chartType enums + the three Output config descriptions.
- `helio-mcp/src/tools/chartTypes.ts` — new: single MCP chart-type const.
- `helio-mcp/src/tools/proposal.ts`, `helio-mcp/src/tools/outputs.ts` — enum / doc text from the const (slots + binCount described).
- `helio-mcp/src/tools/chartTypes.guard.test.ts` — new GUARD (6 enums == const; propose_dashboard enum built from it).

## Frontend
- `frontend/src/utils/chartTypes.ts` — new: `CHART_TYPES`, `NON_AGGREGATING_CHART_TYPES`, `isNonAggregatingChartType`, `isSelectableChartType`, `isChartType` (echarts-free; re-exported from `chartAppearance.ts`).
- `frontend/src/utils/chartAppearance.ts` — re-exports the set; `ChartThemeTokens.accent` (`--app-accent`, regex-guarded so `color-mix()` never reaches zrender; no echarts import).
- `frontend/src/utils/histogramBins.ts` — new: pure binning (Sturges 1-50, equal width, last bin inclusive, single bin when min == max, skipped count).
- `frontend/src/utils/chartClickSelection.ts` — no selection for heatmap/histogram.
- `frontend/src/features/panels/types/panel.ts` — `ChartType` use, `HistogramChartOptions`.
- `frontend/src/features/panels/ui/echartsCore.ts` — register `HeatmapChart` + `VisualMapComponent`.
- `frontend/src/features/panels/ui/heatmapHistogramOptions.ts` — new: heatmap/histogram data options, visualMap theming (accent ramp), heatmap yAxis merge, compact sizing.
- `frontend/src/features/panels/ui/chartDataOptions.ts` — new branches before column-0 resolution; histogram bars `cursor: "default"`.
- `frontend/src/features/panels/ui/buildChartOption.ts` — histogram options plumbed, heatmap yAxis merge, visualMap theme + tooltip, compact grid room.
- `frontend/src/features/panels/ui/ChartPanel.tsx`, `useHeatmapDefaultCursor.ts` — heatmap canvas cursor forced to default (zr mousemove, attached per chart instance via `onChartReady`).
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx`, `frontend/src/features/panels/ui/PanelContent.css` — histogram skipped-values note in the footnote slot.
- `frontend/src/features/panels/ui/{ChartOutputPanel.tsx,resolvePanelChartType.ts,useChartClickHandler.ts}`, `frontend/src/features/panels/hooks/usePanelCardInspect.ts`, `frontend/src/features/panels/history/chartOverlay.ts` — non-aggregating set, `chartType` compare blocker (first), no overlay.
- `frontend/src/features/pipelines/ui/outputHistory/HistoryChart.tsx` — muted note for these types.
- `frontend/src/features/pipelines/ui/outputEditor/{OutputKindFields,OutputKindConfigCard,OutputEditorSheet,useOutputKindState,buildOutputConfig,outputConfigTypes,ChartCompareField}.ts(x)` — type options, slot pickers wiring, `setChartFieldSlot`, numeric list from capabilities, aggregation hint, aggregate-tail disabled, binCount sanitising, parameterised compare note, help text.
- `frontend/src/features/pipelines/ui/outputEditor/{ChartSlotFields,HistogramBinCountField}.tsx`, `OutputEditorSheet.css` — new pickers / bin-count control (44px floor on touch).
- Tests: `frontend/src/utils/{histogramBins,chartTypes.guard,chartClickSelection.heatmapHistogram}.test.ts`, `frontend/src/features/panels/ui/{buildChartOption.heatmapHistogram,ChartPanel.heatmapHistogram}.test.ts(x)`, `.../renderers/ChartRenderer.histogramNote.test.tsx`, `.../history/chartOverlay.heatmapHistogram.test.ts`, `.../outputHistory/HistoryChart.heatmapHistogram.test.tsx`, `.../outputEditor/{OutputEditorSheet.heatmapHistogram,buildOutputConfig,outputConfigTypes}.test.ts(x)`, the `OutputEditorSheet.openingState` snapshot (4 intentional help-text lines), and `accent` added to five existing theme-token fixtures.
- `e2e/hel1311-heatmap-histogram-charts.spec.ts` — live dashboard (light/dark x 1440/375 + Yellow/light) and Output editor checks.

## Specs
- `openspec/specs/chart-type-selector/spec.md` — Purpose lists heatmap and histogram (task 4.10).

## ChartAppearanceEditor reachability (task 3.8)
`frontend/src/features/panels/ui/editors/ChartAppearanceEditor.tsx` is NOT reachable: its only caller is `AppearanceEditor`, which renders it behind `showChartSection`, and its only caller `PanelDetailModal.tsx` hard-codes `showChartSection={false}`. Its chart-type radio list was therefore left unchanged (the chart-type-selector spec also states the modal shows no chart-type selector).

## Bundle size (`npm --prefix frontend run build`, before = unchanged frontend, after = this change)
| chunk | before | after |
| --- | --- | --- |
| echarts chunk (was named `chartAppearance-*`, now `echartsCore-*`: `chartAppearance.ts` no longer pulls into the main chunk) | 585.88 kB / 198.30 kB gzip | 627.45 kB / 210.94 kB gzip (+41.57 / +12.64) |
| `index-*.js` (main entry) | 1,014.01 kB / 276.02 kB gzip | 1,021.88 kB / 278.55 kB gzip (+7.87 / +2.53) |
| `ChartPanel-*.js` | 8.87 kB / 3.41 kB gzip | 11.38 kB / 4.32 kB gzip (+2.51 / +0.91) |
The echarts growth is `HeatmapChart` + `VisualMapComponent`; the main-entry growth is the editor controls, binning and the shared chart-type set (no echarts import added there: the accent guard is a regex, not zrender `parse`).

## Deviations from design.md (all noted for the evaluator)
- Heatmap colour: `inRange.color` is a two-stop ramp `[accent at 0.25 alpha, accent]` instead of `color: [accent]` + `opacity: [0.25, 1]`. Observed on the running app: ECharts' legend bar ignores the opacity channel (flat solid bar that did not match the cells); the ramp makes the bar show what the cells show. Same token (`--app-accent`), no new theme token, same 0.25 floor. Also added end labels (`text`) so the legend states min and max.
- Cursor: HeatmapView does not read `cursor` (confirmed in `HeatmapView.js`); the zr `mousemove` reset is attached through `onChartReady` rather than an effect, because an effect-registered handler was left on a disposed chart instance (observed: canvas cursor was `pointer` on the running app until fixed).
- The bin-count control lives in `HistogramBinCountField.tsx` (outputEditor), not `ChartDisplayFields.tsx`: same behaviour, keeps the shared display fields untouched.
- The hook-level selection guard in `useChartClickHandler` was dropped as redundant (`mapChartClickToSelection` is the single, tested gate; the click is still swallowed).

## Cycle 2 (evaluation-1.md)
- CR-1: `HistogramBinCountField.tsx` reports an invalid draft (`onInvalidChange`); `useOutputKindState` holds `binCountInvalid`; `OutputEditorFooter` `saveBlocked` disables Save. Tests in `OutputEditorSheet.heatmapHistogram.test.tsx` (red evidence `red-cycle2-bincount-save.txt`).
- CR-2: `ApiRoutesSpec.scala` — PATCH `/api/panels/:id` stores heatmap/histogram and 400s `area` listing all six (red when `ChartTypes.All` is shrunk: `red-cycle2-panel-appearance.txt`).
- CR-3: `design.md` D4/D6/D7 describe the built behaviour. Suggestion taken: `scatterCheck` renamed `nonAggregatingCheck`.

## Cycle 3 (skeptic-final-1.md)
- `heatmapHistogramOptions.ts`: visualMap `outOfRange` transparent so legend and cells blend identically; test in `buildChartOption.heatmapHistogram.test.ts` (red: `red-cycle3-visualmap-outofrange.txt`); e2e legend-vs-cell pixel check (red on old code: `red-cycle3-legend-pixels-before.txt`; green: `legend-vs-cell-pixels.txt`, screenshots in `screenshots-cycle3/`).
- Histogram aggregation hint now says it counts rows into bins; histogram picker accessible name is "Histogram field". design.md D4 updated.

## Declared paths (full list, for squash-branch.sh)
- `backend/src/main/scala/com/helio/api/http/RequestValidation.scala`
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala`
- `backend/src/main/scala/com/helio/domain/history/OutputSummaryReducer.scala`
- `backend/src/main/scala/com/helio/domain/panels/ChartTypes.scala`
- `backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala`
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala`
- `backend/src/test/scala/com/helio/domain/panels/ChartTypesSchemaGuardSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/OutputConfigValidationSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/OutputHeatmapHistogramSpec.scala`
- `e2e/hel1311-heatmap-histogram-charts.spec.ts`
- `frontend/src/features/panels/history/chartOverlay.heatmapHistogram.test.ts`
- `frontend/src/features/panels/history/chartOverlay.ts`
- `frontend/src/features/panels/hooks/usePanelCardInspect.ts`
- `frontend/src/features/panels/types/panel.ts`
- `frontend/src/features/panels/ui/ChartOutputPanel.tsx`
- `frontend/src/features/panels/ui/ChartPanel.defaultAppearance.test.tsx`
- `frontend/src/features/panels/ui/ChartPanel.heatmapHistogram.test.tsx`
- `frontend/src/features/panels/ui/ChartPanel.theme.test.tsx`
- `frontend/src/features/panels/ui/ChartPanel.tsx`
- `frontend/src/features/panels/ui/PanelCard.aggregatePieChart.test.tsx`
- `frontend/src/features/panels/ui/PanelContent.css`
- `frontend/src/features/panels/ui/buildChartOption.heatmapHistogram.test.ts`
- `frontend/src/features/panels/ui/buildChartOption.overlay.test.ts`
- `frontend/src/features/panels/ui/buildChartOption.textColor.test.ts`
- `frontend/src/features/panels/ui/buildChartOption.ts`
- `frontend/src/features/panels/ui/chartDataOptions.ts`
- `frontend/src/features/panels/ui/chartOverlayOption.ts`
- `frontend/src/features/panels/ui/echartsCore.ts`
- `frontend/src/features/panels/ui/heatmapHistogramOptions.ts`
- `frontend/src/features/panels/ui/renderers/ChartRenderer.histogramNote.test.tsx`
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx`
- `frontend/src/features/panels/ui/resolvePanelChartType.ts`
- `frontend/src/features/panels/ui/useChartClickHandler.ts`
- `frontend/src/features/panels/ui/useHeatmapDefaultCursor.ts`
- `frontend/src/features/pipelines/ui/outputEditor/ChartCompareField.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/ChartSlotFields.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/HistogramBinCountField.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorFooter.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.heatmapHistogram.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/__snapshots__/OutputEditorSheet.openingState.test.tsx.snap`
- `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.test.ts`
- `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts`
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.test.ts`
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts`
- `frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts`
- `frontend/src/features/pipelines/ui/outputHistory/HistoryChart.heatmapHistogram.test.tsx`
- `frontend/src/features/pipelines/ui/outputHistory/HistoryChart.tsx`
- `frontend/src/utils/chartAppearance.ts`
- `frontend/src/utils/chartClickSelection.heatmapHistogram.test.ts`
- `frontend/src/utils/chartClickSelection.ts`
- `frontend/src/utils/chartTypes.guard.test.ts`
- `frontend/src/utils/chartTypes.ts`
- `frontend/src/utils/histogramBins.test.ts`
- `frontend/src/utils/histogramBins.ts`
- `helio-mcp/src/tools/chartTypes.guard.test.ts`
- `helio-mcp/src/tools/chartTypes.ts`
- `helio-mcp/src/tools/outputs.ts`
- `helio-mcp/src/tools/proposal.ts`
- `openspec/specs/chart-type-selector/spec.md`
- `schemas/dashboards/dashboard-proposal.schema.json`
- `schemas/outputs/create-output-request.schema.json`
- `schemas/outputs/update-output-request.schema.json`
- `schemas/panels/panel-appearance-patch.schema.json`
- `schemas/panels/panel-appearance.schema.json`
- `schemas/pipelines/create-pipeline-transactional-output-request.schema.json`
