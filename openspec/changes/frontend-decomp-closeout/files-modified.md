# Files Modified — Cycle 1

Snapshot of files touched in CS4 cycle 1 (mechanical `models.ts`
decomposition + test rename). All edits behavior-preserving.

## New files (6)

- `frontend/src/features/auth/types/user.ts` — auth domain types (`User`, `UserPreferences`, `UserPreferencePayload`, `AuthResponse`, `UpdateUserPreferenceRequest`)
- `frontend/src/features/dashboards/types/dashboard.ts` — dashboard domain types (`Dashboard`, `DashboardAppearance`, `DashboardLayout`, `DashboardLayoutItem`, `DashboardSnapshot*`, `DashboardUpdatePayload`, `UpdateDashboardBatchRequest`, `DuplicateDashboardResponse`)
- `frontend/src/features/dataTypes/types/dataType.ts` — DataType domain types (`DataType`, `DataTypeField`, `ComputedField`)
- `openspec/changes/frontend-decomp-closeout/.openspec.yaml` — change metadata
- `openspec/changes/frontend-decomp-closeout/executor-report-1.md` — this cycle's report
- `openspec/changes/frontend-decomp-closeout/files-modified.md` — this handoff

## Significantly modified type-home files

- `frontend/src/features/panels/types/panel.ts` — gained 17 panel-adjacent types (chart appearance shapes, `PanelAppearance`, creation `TypeConfig` union, batch shapes, pagination state); 190L → 279L
- `frontend/src/features/pipelines/types/pipelineStep.ts` — gained 5 summary types (`Pipeline`, `PipelineSummary`, `RunStatus`, `RunStatusResponse`, `PipelineRunRecord`); 216L → 255L
- `frontend/src/features/sources/types/dataSource.ts` — gained 4 schema types (`InferredField`, `StaticColumnType`, `StaticColumn`, `StaticSourcePayload`); 78L → 102L
- `frontend/src/types/models.ts` — trimmed 372L → 19L; now hosts only `ResourceMeta` cross-cutting type per design D7 recommendation (a); both DataSource and PipelineStep re-export blocks deleted (task 1.8)

## Test rename

- `frontend/src/features/panels/ui/PanelDetailModal.computedFields.test.tsx` — renamed + moved from `features/pipelines/ui/ComputedFieldPicker.test.tsx`; the test exercises `PanelDetailModal` not `ComputedFieldPicker`. Imports adjusted for the new path; test contents unchanged

## OpenSpec change folder

- `openspec/changes/frontend-decomp-closeout/{ticket,proposal,design,tasks,workflow-state}.md` — change definition + tasks tracker (cycle 1 tasks marked `[x]`)

## Import-path consumer updates (~80 files)

The bulk of cycle 1 is consumer-import updates. Every file listed below
had at least one `import … from "..../types/models"` re-pointed at its
type's new feature-folder home. Grouped by domain.

### auth (4 consumer files)

- `frontend/src/features/auth/services/authService.ts`
- `frontend/src/features/auth/state/authSlice.ts`
- `frontend/src/features/auth/state/authSlice.test.ts`
- `frontend/src/features/auth/ui/OAuthCallbackPage.test.tsx`
- `frontend/src/features/auth/ui/UserMenu.tsx`
- `frontend/src/features/auth/ui/UserMenu.test.tsx`

### dashboards + layout (7 consumer files)

- `frontend/src/features/dashboards/services/dashboardService.ts`
- `frontend/src/features/dashboards/state/dashboardLayout.ts`
- `frontend/src/features/dashboards/state/dashboardsSlice.ts`
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx`
- `frontend/src/features/dashboards/ui/DashboardList.tsx`
- `frontend/src/features/layout/hooks/useLayoutUndoRedo.test.ts`
- `frontend/src/features/layout/state/layoutHistorySlice.ts`
- `frontend/src/features/layout/state/layoutHistorySlice.test.ts`

### dataTypes (4 consumer files)

- `frontend/src/features/dataTypes/services/dataTypeService.ts`
- `frontend/src/features/dataTypes/state/dataTypesSlice.ts`
- `frontend/src/features/dataTypes/ui/TypeDetailPanel.tsx`
- `frontend/src/features/dataTypes/ui/TypeRegistryBrowser.tsx`

### panels (~30 consumer files)

- `frontend/src/features/panels/hooks/useLegacyBoundPanel.ts`
- `frontend/src/features/panels/hooks/useLegacyBoundPanel.test.ts`
- `frontend/src/features/panels/hooks/usePanelData.ts`
- `frontend/src/features/panels/hooks/usePanelData.test.ts`
- `frontend/src/features/panels/hooks/usePanelGridSave.ts`
- `frontend/src/features/panels/services/panelService.ts`
- `frontend/src/features/panels/state/panelPayloads.ts`
- `frontend/src/features/panels/state/panelSlots.ts`
- `frontend/src/features/panels/state/panelTemplates.ts`
- `frontend/src/features/panels/state/panelThunks.ts`
- `frontend/src/features/panels/state/panelsSlice.ts`
- `frontend/src/features/panels/state/panelsSlice.test.ts`
- `frontend/src/features/panels/ui/ChartPanel.tsx`
- `frontend/src/features/panels/ui/PanelContent.tsx`
- `frontend/src/features/panels/ui/PanelCreationModal.tsx`
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx`
- `frontend/src/features/panels/ui/PanelCreationPreview.tsx`
- `frontend/src/features/panels/ui/PanelDetailModal.tsx`
- `frontend/src/features/panels/ui/PanelGrid.tsx`
- `frontend/src/features/panels/ui/panelGridConfig.ts`
- `frontend/src/features/panels/ui/editors/AppearanceEditor.tsx`
- `frontend/src/features/panels/ui/editors/BindingEditor.tsx`
- `frontend/src/features/panels/ui/editors/ChartAppearanceEditor.tsx`
- `frontend/src/features/panels/ui/editors/DividerEditor.tsx`
- `frontend/src/features/panels/ui/editors/ImageEditor.tsx`
- `frontend/src/features/panels/ui/editors/MarkdownEditor.tsx`
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx`
- `frontend/src/features/panels/ui/renderers/DividerRenderer.tsx`
- `frontend/src/features/panels/ui/renderers/ImageRenderer.tsx`
- `frontend/src/features/panels/ui/renderers/MarkdownRenderer.tsx`
- `frontend/src/features/panels/ui/renderers/MetricRenderer.tsx`
- `frontend/src/features/panels/ui/renderers/TextRenderer.tsx`

### pipelines (~16 consumer files)

- `frontend/src/features/pipelines/hooks/useAnalyzePipeline.ts`
- `frontend/src/features/pipelines/services/pipelineService.ts`
- `frontend/src/features/pipelines/state/pipelinesSlice.ts`
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts`
- `frontend/src/features/pipelines/ui/AggregateConfig.tsx`
- `frontend/src/features/pipelines/ui/AggregateConfig.test.tsx`
- `frontend/src/features/pipelines/ui/ComputedFieldForm.tsx`
- `frontend/src/features/pipelines/ui/ComputedFieldsEditor.tsx`
- `frontend/src/features/pipelines/ui/ComputedFieldsEditor.test.tsx`
- `frontend/src/features/pipelines/ui/CreatePipelineModal.test.tsx`
- `frontend/src/features/pipelines/ui/FilterConfig.tsx`
- `frontend/src/features/pipelines/ui/FilterConfig.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineListTable.tsx`
- `frontend/src/features/pipelines/ui/RunHistoryModal.tsx`
- `frontend/src/features/pipelines/ui/SourceChip.tsx`
- `frontend/src/features/pipelines/ui/SourceSelectorBar.tsx`

### sources (8 consumer files)

- `frontend/src/features/sources/services/dataSourceService.ts`
- `frontend/src/features/sources/state/sourcesSlice.ts`
- `frontend/src/features/sources/state/sourcesSlice.test.ts`
- `frontend/src/features/sources/ui/AddSourceModal.tsx`
- `frontend/src/features/sources/ui/DataSourceList.tsx`
- `frontend/src/features/sources/ui/InferredFieldsTable.tsx`
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx`
- `frontend/src/features/sources/ui/SqlTab.tsx`
- `frontend/src/features/sources/ui/SqlTab.test.tsx`
- `frontend/src/features/sources/ui/StaticSourceForm.tsx`

### Cross-cutting (4 files)

- `frontend/src/test/panelFixtures.ts` — panel types re-pointed at `features/panels/types/panel`
- `frontend/src/test/renderWithStore.tsx` — re-pointed each consumer-type import at its new feature-folder home (auth, dashboards, dataTypes, pipelines, panels, sources)
- `frontend/src/theme/appearance.ts` — `DashboardAppearance` + `PanelAppearance` re-pointed at feature-folder modules
- `frontend/src/utils/chartAppearance.ts` + `frontend/src/utils/chartAppearance.test.ts` — `ChartAppearance` re-pointed at `features/panels/types/panel`
