# Inventory of record (task 2.1): guard installed, empty allowlist, full suite

| file | requests (METHOD URL x count) |
|---|---|
| src/features/panels/ui/PanelCard.crossFilter.test.tsx | GET /api/outputs/output-1/history x4 |
| src/features/panels/ui/grid/PanelGrid.test.tsx | GET /api/outputs/output-1 x42; GET /api/outputs/output-1/assertion-status x30 |
| src/features/pipelines/ui/PipelineDetailPage.runHistory.test.tsx | GET /api/pipelines/pipe-a/outputs x24; GET /api/pipelines/pipe-b/outputs x4; GET /api/pipelines/pipe-t/outputs x6 |
| src/app/App.test.tsx | GET /api/connector-types x6; GET /api/connectors x6; GET /api/outputs/output-1 x6; GET /api/outputs/output-1/assertion-status x4; GET /api/outputs/output-1/filter-capabilities x2; GET /api/outputs/output-1/panels x2; GET /api/outputs/output-1/rows?offset=0&limit=200 x6; GET /api/outputs/output-2 x2; GET /api/outputs/output-2/assertion-status x2; GET /api/outputs/output-2/rows?offset=0&limit=200 x2; GET /api/outputs?offset=0&limit=200 x6; GET /api/pipelines/pipe-1/outputs x2 |
| src/features/pipelines/ui/PipelineDetailPage.stepsError.test.tsx | GET /api/data-sources x14; GET /api/pipelines/pipe-1/outputs x14 |
| src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx | GET /api/pipelines/pipe-1/outputs x24 |
| src/app/AppShell.rail.test.tsx | GET /api/connectors x2 |
| src/features/pipelines/ui/stepConfigs/JoinConfig.test.tsx | GET /api/data-sources x24 |
| src/features/sources/ui/SourcesPage.test.tsx | GET /api/connector-types x4; GET /api/connectors x4 |
| src/features/pipelines/ui/PipelineDetailPage.creatingStep.test.tsx | GET /api/pipelines/pipe-1/outputs x8 |
| src/features/pipelines/ui/PipelineDetailPage.test.tsx | GET /api/pipelines/pipe-1/outputs x260 |
| src/features/pipelines/ui/StepCard.test.tsx | GET /api/data-sources x2 |
| src/features/commandPalette/ui/CommandPalette.test.tsx | GET /api/dashboards x30; GET /api/data-sources x24; GET /api/outputs?offset=0&limit=200 x30; GET /api/pipelines x30 |
| src/features/panels/ui/PanelContent.test.tsx | GET /api/outputs/output-1/history x2 |
| src/features/panels/ui/detailModal/PanelDetailModal.aggregateChart.test.tsx | GET /api/outputs/output-1/filter-capabilities x2; GET /api/outputs/output-1/panels x2 |
| src/features/panels/ui/grid/DesktopPanelGrid.layoutCommit.test.tsx | GET /api/outputs/output-1 x34; GET /api/outputs/output-1/assertion-status x34 |
| src/features/panels/ui/grid/DesktopPanelGrid.placementVersion.test.tsx | GET /api/outputs/output-1 x8; GET /api/outputs/output-1/assertion-status x8 |
| src/features/pipelines/ui/PipelineDetailPage.skeletonDom.test.tsx | GET /api/data-sources x2; GET /api/pipelines/pipe-1/outputs x2 |
| src/features/pipelines/ui/CreatePipelineModal.test.tsx | GET /api/connector-types x2; GET /api/connectors x2 |
| src/features/pipelines/ui/PipelineDetailPage.reorderGuard.test.tsx | GET /api/data-sources x2; GET /api/pipelines/pipe-1/outputs x2 |
| src/features/pipelines/ui/StepCard.blurNoRepatch.test.tsx | GET /api/data-sources x4 |
| src/features/panels/ui/grid/DesktopPanelGrid.inflightResponse.test.tsx | GET /api/outputs/output-1 x10; GET /api/outputs/output-1/assertion-status x10 |
| src/features/panels/ui/grid/DesktopPanelGrid.layoutPatch.test.tsx | GET /api/outputs/output-1 x8; GET /api/outputs/output-1/assertion-status x8 |
| src/features/panels/ui/grid/DesktopPanelGrid.layoutConflict.test.tsx | GET /api/outputs/output-1 x8; GET /api/outputs/output-1/assertion-status x8 |
| src/features/panels/ui/grid/MobilePanelStack.test.tsx | GET /api/outputs/output-1 x16 |
| src/features/pipelines/hooks/usePipelineDetailPage.identity.test.tsx | GET /api/data-sources x4; GET /api/pipelines/pipe-1/outputs x4 |
| src/features/panels/ui/PanelList.test.tsx | GET /api/data-sources x2; GET /api/pipelines x2 |
| src/features/panels/ui/grid/DesktopPanelGrid.derivedLayout.test.tsx | GET /api/outputs/output-1 x12; GET /api/outputs/output-1/assertion-status x12 |
| src/features/pipelines/ui/stepConfigs/LookupConfig.uniqueId.test.tsx | GET /api/data-sources x8 |
| src/features/pipelines/ui/stepConfigs/UpsertSourceConfig.test.tsx | GET /api/data-sources x32 |
| src/features/pipelines/ui/stepConfigs/UnionConfig.test.tsx | GET /api/data-sources x16 |
| src/features/pipelines/ui/stepConfigs/SecondaryInputPicker.test.tsx | GET /api/data-sources x14 |
| src/features/pipelines/ui/stepConfigs/LookupConfig.test.tsx | GET /api/data-sources x20 |
| src/features/panels/ui/grid/DesktopPanelGrid.processedWidth.test.tsx | GET /api/outputs/output-1 x4; GET /api/outputs/output-1/assertion-status x4 |
| src/test/panelActionsAccessibleName.test.tsx | GET /api/outputs/output-1 x2; GET /api/outputs/output-1/assertion-status x2; GET /api/outputs/output-1/rows?offset=0&limit=200 x2 |
| src/features/panels/ui/grid/MobilePanelStack.provenance.test.tsx | GET /api/outputs/output-1 x4 |
| src/features/pipelines/ui/stepConfigs/JoinConfig.seam.test.tsx | GET /api/data-sources x4 |
| src/features/panels/ui/PanelCard.filterEmptyState.test.tsx | GET /api/outputs/output-1/rows?offset=0&limit=200&filter=%7B%22quick%22:%22nonexistent-term%22%7D x2 |
| src/test/rawElementGuardHel440.test.tsx | GET /api/outputs/output-1 x2; GET /api/outputs/output-1/assertion-status x2 |
| src/features/panels/ui/PanelCardBody.predispatch.test.tsx | GET /api/outputs/output-1/rows?offset=0&limit=200 x4 |

Failed files with no guard message: []

## Classification (cycle 2)

40 flagged files: 30 fixed at the service seam; 10 allowlisted (parked/concurrent lane edits them): App, AppShell.rail, CommandPalette, PanelList, PipelineDetailPage, .creatingStep, .draftCreate, .reorderGuard, .stepsError (HEL-1575/1578/1579) and DesktopPanelGrid.processedWidth (HEL-1576, reverted to main in cycle 2). Checked against HEL-1572/1575/1576/1578/1579/1583/1599/1606.
