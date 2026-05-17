# Files Modified — CS3 cycle 1

This change is a behavior-preserving structural restructure: 198 renames +
~14 import-only edits across 212 files. The list below groups by destination
folder rather than enumerating every file (the rename map is fully visible
in the per-commit log).

## Folder-level summary

### features/auth/ (Reality 1 — migrated to nested layout)

- `features/auth/ui/` — LoginPage, OAuthCallbackPage, RegisterPage, ProtectedRoute, PublicOnlyRoute, UserMenu (+ CSS + tests); `auth.css`
- `features/auth/state/` — authSlice (+ test)
- `features/auth/services/` — authService

### features/dashboards/

- `features/dashboards/ui/` — DashboardList, DashboardAppearanceEditor (+ CSS + tests)
- `features/dashboards/state/` — dashboardsSlice, dashboardLayout (+ tests)
- `features/dashboards/services/` — dashboardService

### features/dataTypes/

- `features/dataTypes/ui/` — TypeDetailPanel, TypeRegistryBrowser, TypeRegistryPage (+ CSS + test)
- `features/dataTypes/state/` — dataTypesSlice (+ test)
- `features/dataTypes/services/` — dataTypeService

### features/sources/

- `features/sources/ui/` — AddSourceModal, DataSourceList, SourceDetailPanel, SourcesPage, SqlTab, StaticSourceForm (+ CSS + tests)
- `features/sources/state/` — sourcesSlice (+ test)
- `features/sources/services/` — dataSourceService
- `features/sources/types/` — dataSource (typed ADT)

### features/pipelines/

- `features/pipelines/ui/` — PipelineDetailPage, PipelineEmptyState, PipelineListTable, PipelinePreviewModal, PipelinesPage, Aggregate/Cast/Compute/Filter/Limit/Rename/Select/Sort/Cast/RunHistory/Create Configs and modals, ComputedField{Form,Picker,sEditor} (+ CSS + tests)
- `features/pipelines/state/` — pipelinesSlice (+ test)
- `features/pipelines/hooks/` — useAnalyzePipeline, usePipelineRunEvents (+ test)
- `features/pipelines/services/` — pipelineService
- `features/pipelines/types/` — pipelineStep

### features/panels/ (largest)

- `features/panels/ui/` — PanelGrid, PanelDetailModal, PanelContent, PanelCreationModal, PanelCreationPreview, PanelList, PanelLegacyWarning, ChartPanel, DividerPanel, ImagePanel, MarkdownPanel, PreviewTable, panelGridConfig (+ CSS + tests)
- `features/panels/ui/editors/` — AppearanceEditor, BindingEditor, ChartAppearanceEditor, DividerEditor, ImageEditor, MarkdownEditor, editorTypes (CS2c-3c carryover)
- `features/panels/ui/renderers/` — Chart, Divider, Image, Markdown, Metric, Table, Text renderers (CS2c-3c carryover)
- `features/panels/state/` — panelsSlice, panelActions, panelNarrowing, panelPayloads, panelSlots, panelTemplates, panelThunks (+ slice tests)
- `features/panels/hooks/` — usePanelData, useLegacyBoundPanel, usePanelGridSave, usePanelDetailModalLifecycle, usePanelPolling (+ tests)
- `features/panels/services/` — panelService
- `features/panels/types/` — panel (typed ADT)

### features/layout/

- `features/layout/state/` — layoutHistorySlice (+ test)
- `features/layout/hooks/` — useLayoutUndoRedo (+ test)

### features/toasts/

- `features/toasts/state/` — toastsSlice, toastListeners (+ slice test)
- `features/toasts/hooks/` — useToast

### shared/

- `shared/chrome/` — StatusMessage, Popover.css, OverlayProvider, SaveStateIndicator, SidebarBody, SidebarItemList, ActionsMenu, AccentPicker, OrbitMark, InlineError (+ CSS + tests)
- `shared/ui/` — EmptyState, Modal, Select, Textarea, TextField, Toast, inputs.css, toast.css, index.ts (former `components/ui/`)

### Top-level files modified (import-only edits, no rename)

- `frontend/src/app/App.tsx`, `App.test.tsx` — adopted new import paths
- `frontend/src/main.tsx` — adopted new import paths
- `frontend/src/pages/DataSourcesPage.tsx`, `.test.tsx` — adopted new import paths
- `frontend/src/store/store.ts` — slice import paths updated
- `frontend/src/test/renderWithStore.tsx` — slice import paths updated
- `frontend/src/types/models.ts` — re-export shim's `./dataSource`, `./panel`, `./pipelineStep` paths updated to point to feature folders

### Top-level folders that did NOT move (per design D3)

- `app/`, `pages/`, `context/`, `store/`, `theme/`, `utils/`, `config/`, `test/`, `main.tsx`
- `hooks/` — now holds only `reduxHooks.ts`, `useRelativeTime.ts` (+ test)
- `services/` — now holds only `httpClient.ts` (+ test)
- `types/` — now holds only `models.ts` (cross-cutting residue + re-export shim; see Reality 7 decision in executor-report-1.md)

### Removed folders

- `frontend/src/components/` — emptied and removed (was 53 non-test files mixed across all domains + `components/ui/` + `components/panels/{editors,renderers}/`)
