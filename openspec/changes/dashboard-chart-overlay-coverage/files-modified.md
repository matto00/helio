# Files modified — HEL-1351

Every path changed on the branch vs merge-base a606a9833 (no deletions). Per-area intent, from the executor's handoff:
chartOverlay.ts (D1/D4/D5), resolvePanelChartType.ts (D7), ChartOutputPanel.tsx (D2/D3/D7), click-spec threading (1.5c),
chartClickSelection.ts/PanelInspectView.tsx (D3), record-row threading and dead chartAggregate removal (1.3/1.4),
buildChartOption/chartDataOptions/aggregate (D6/D4a), outputEditor copy (D5); tests and PanelData-mock fixture edits
dropping the removed chartAggregate field; e2e spec.

- `e2e/hel1351-aggregated-chart-overlay.spec.ts`
- `frontend/src/features/panels/history/chartOverlay.test.ts`
- `frontend/src/features/panels/history/chartOverlay.ts`
- `frontend/src/features/panels/hooks/useCrossFilteredPanelData.test.ts`
- `frontend/src/features/panels/hooks/useCrossFilteredPanelData.ts`
- `frontend/src/features/panels/hooks/usePanelData.test.ts`
- `frontend/src/features/panels/hooks/usePanelData.ts`
- `frontend/src/features/panels/ui/ChartOutputPanel.aggregate.test.tsx`
- `frontend/src/features/panels/ui/ChartOutputPanel.tsx`
- `frontend/src/features/panels/ui/ChartPanel.tsx`
- `frontend/src/features/panels/ui/PanelCard.aggregateChart.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.filterEmptyState.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.filterTyping.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.filteredMetric.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.firstDashboardTelemetry.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.inspect.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.loadMoreCarriesSortFilter.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.provenance.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.staleFetchSequencing.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.fanoutStatus.test.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.predispatch.test.tsx`
- `frontend/src/features/panels/ui/PanelContent.tsx`
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.aggregateChart.test.tsx`
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.provenance.test.tsx`
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.test.tsx`
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx`
- `frontend/src/features/panels/ui/PanelInspectView.tsx`
- `frontend/src/features/panels/ui/buildChartOption.overlay.test.ts`
- `frontend/src/features/panels/ui/buildChartOption.ts`
- `frontend/src/features/panels/ui/chartDataOptions.ts`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.aggregateChart.test.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.panelSwitch.test.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.provenance.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx`
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx`
- `frontend/src/features/panels/ui/resolvePanelChartType.ts`
- `frontend/src/features/panels/ui/useChartClickHandler.ts`
- `frontend/src/features/pipelines/ui/outputEditor/ChartCompareField.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.compare.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx`
- `frontend/src/test/rawElementGuardHel440.test.tsx`
- `frontend/src/utils/aggregate.ts`
- `frontend/src/utils/chartClickSelection.ts`
