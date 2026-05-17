# Tasks — Frontend feature-folder restructure

## Cycle 1 — Mechanical restructure (behavior-preserving)

### 1. Establish target folder skeleton
- [x] 1.1 Create `features/<domain>/{ui,state,hooks,services,types}/` subfolders for each domain (only non-empty ones)
- [x] 1.2 Create `shared/{ui,chrome}/` folders

### 2. Move per-domain UI components into `features/<domain>/ui/`
- [x] 2.1 `features/panels/ui/` — PanelGrid, PanelDetailModal, PanelContent, PanelCreationModal, PanelCreationPreview, PanelList, PanelLegacyWarning, ChartPanel, DividerPanel, ImagePanel, MarkdownPanel, PreviewTable, panelGridConfig + CS2c-3c's panels/{editors,renderers}/ subfolders
- [x] 2.2 `features/pipelines/ui/` — PipelineDetailPage, PipelineEmptyState, PipelineListTable, PipelinePreviewModal, PipelinesPage, AggregateConfig, CastFieldsConfig, ComputeFieldConfig, ComputedFieldForm, ComputedFieldPicker, ComputedFieldsEditor, CreatePipelineModal, FilterConfig, LimitConfig, RenameFieldsConfig, RunHistoryModal, SelectFieldsConfig, SortConfig
- [x] 2.3 `features/sources/ui/` — AddSourceModal, DataSourceList, SourceDetailPanel, SourcesPage, SqlTab, StaticSourceForm
- [x] 2.4 `features/dataTypes/ui/` — TypeDetailPanel, TypeRegistryBrowser, TypeRegistryPage
- [x] 2.5 `features/dashboards/ui/` — DashboardList, DashboardAppearanceEditor
- [x] 2.6 `features/auth/ui/` — LoginPage, OAuthCallbackPage, RegisterPage, ProtectedRoute, PublicOnlyRoute, UserMenu (LoginPage/OAuth/Register already in `features/auth/` flat; move to ui/)
- [x] 2.7 `shared/chrome/` — StatusMessage, Popover.css, OverlayProvider, SaveStateIndicator, SidebarBody, SidebarItemList, ActionsMenu, AccentPicker, OrbitMark, InlineError
- [x] 2.8 `shared/ui/` — current `components/ui/` contents (Select.tsx etc.)

### 3. Move domain-specific hooks into `features/<domain>/hooks/`
- [x] 3.1 `features/panels/hooks/` — usePanelData, useLegacyBoundPanel, usePanelGridSave, usePanelDetailModalLifecycle, usePanelPolling
- [x] 3.2 `features/pipelines/hooks/` — useAnalyzePipeline, usePipelineRunEvents
- [x] 3.3 `features/layout/hooks/` — useLayoutUndoRedo
- [x] 3.4 `features/toasts/hooks/` — useToast
- [x] 3.5 Leave `hooks/` with cross-cutting only: reduxHooks, useRelativeTime

### 4. Move domain-specific services into `features/<domain>/services/`
- [x] 4.1 `features/auth/services/authService.ts`
- [x] 4.2 `features/dashboards/services/dashboardService.ts`
- [x] 4.3 `features/dataTypes/services/dataTypeService.ts`
- [x] 4.4 `features/panels/services/panelService.ts`
- [x] 4.5 `features/pipelines/services/pipelineService.ts`
- [x] 4.6 `features/sources/services/dataSourceService.ts`
- [x] 4.7 Leave `services/` with httpClient + test only

### 5. Move state subfolders (slices + slice-adjacent) into `features/<domain>/state/`
- [x] 5.1 For each feature folder that today has flat slice files (e.g. `features/panels/panelsSlice.ts`), move into `state/` subfolder
- [x] 5.2 Move slice-adjacent files (panelThunks, panelNarrowing, panelPayloads, panelActions, panelTemplates, panelSlots, dashboardLayout, toastListeners) into their feature's `state/` subfolder
- [x] 5.3 Move slice test files alongside their slice

### 6. Move domain-specific types into `features/<domain>/types/`
- [x] 6.1 `features/panels/types/panel.ts`
- [x] 6.2 `features/pipelines/types/pipelineStep.ts`
- [x] 6.3 `features/sources/types/dataSource.ts`
- [x] 6.4 Evaluate `models.ts` residue per design D8 — extract domain-owned types to their feature; keep cross-cutting at `types/models.ts` OR retire `models.ts` entirely

### 7. Update all import paths
- [x] 7.1 After each commit group, run `npm run build` and `npm test`; fix any path that didn't get updated automatically
- [x] 7.2 Audit for circular imports surfaced by the moves; resolve

### 8. Cycle 1 gates
- [x] 8.1 `sbt test` (backend unchanged — sanity re-run)
- [x] 8.2 `npm run lint` — zero warnings
- [x] 8.3 `npm run format:check` — clean
- [x] 8.4 `npm test` — green
- [x] 8.5 `npm run build` — green
- [x] 8.6 `npm run check:schemas` — 6/6 in sync (unchanged)
- [x] 8.7 `npm run check:openspec` — clean
- [x] 8.8 `npm run check:scala-quality` — clean (unchanged)
- [x] 8.9 `openspec validate frontend-feature-folders` — same status as prior behavior-preserving refactor changes (no spec deltas, validates only via `check:openspec` hygiene which is clean). See executor-report-1.md.
- [x] 8.10 No file >400L hard cap introduced; flag any new soft-cap (>250L) creations
- [x] 8.11 Write `executor-report-1.md` with: scope completed, files moved per domain (counts), import-path updates count, gates run + results, any model.ts retention decision, any new soft-cap files

## Cycle 2 — BLOCKER decompositions

### 9. Decompose `features/pipelines/ui/PipelineDetailPage.tsx` (1200L → <400L)
- [x] 9.1 Extract `StepCard` → `features/pipelines/ui/StepCard.tsx`
- [x] 9.2 Extract `OpDropdown` → `features/pipelines/ui/OpDropdown.tsx`
- [x] 9.3 Extract `SourceChip` → `features/pipelines/ui/SourceChip.tsx`
- [x] 9.4 Extract `RibbonSegment` → `features/pipelines/ui/RibbonSegment.tsx`
- [x] 9.5 Extract narrowing helpers → `features/pipelines/state/stepNarrowing.ts` (state, not ui)
- [x] 9.6 Extract op/step types → `features/pipelines/types/step.ts` or merge into existing pipelineStep types
- [x] 9.7 Verify `PipelineDetailPage.tsx` <400L after extractions (389L; drive-by extracted `PipelineDetailFooter`, `PipelineRiverView`, `SourceSelectorBar` to reach cap — see executor-report-2.md)
- [x] 9.8 Each extracted file <250L soft cap (StepCard at 323L is the lone exception — over 250L soft cap, under 400L hard cap; further per-kind split would mirror CS2c-3c editors and is out of scope here)

### 10. Decompose `features/sources/ui/AddSourceModal.tsx` (475L → <400L)
- [ ] 10.1 Read the file's structure; identify natural decomposition lines (likely per-source-type forms or per-step components)
- [ ] 10.2 Extract per-source-type form bodies into siblings (RestApiForm.tsx, CsvForm.tsx, SqlForm.tsx) — StaticSourceForm already exists separately
- [ ] 10.3 Verify `AddSourceModal.tsx` <400L after extractions
- [ ] 10.4 Each extracted file <250L soft cap

### 11. `PanelCreationModal.tsx` left untouched (CS4 scope)
- [ ] 11.1 Verify file is at `features/panels/ui/PanelCreationModal.tsx` after cycle 1 move
- [ ] 11.2 Document in executor-report-2 that this file remains at 716L (>400L hard cap) deliberately for CS4 per-subtype decomposition

### 12. Cycle 2 gates
- [ ] 12.1 All cycle-1 gates re-run green
- [ ] 12.2 File-size BLOCKER check: NO file >400L EXCEPT `PanelCreationModal.tsx` (716L, CS4-tagged)
- [ ] 12.3 Playwright Phase 3 smoke (evaluator scope) — UI parity with main, no regressions; pipeline detail page renders + works; add-source modal renders + works
- [ ] 12.4 Write `executor-report-2.md`

## Out of scope (do NOT touch)

- `PanelCreationModal.tsx` decomposition (CS4)
- Behavior changes to any moved file
- Backend, schemas, OpenSpec specs (other than this change folder), HEL-242, HEL-256
- `useLegacyBoundPanel` removal (CS3-era spinoff but explicitly NOT this PR)
- `appearance.chart` → `ChartPanelConfig` migration (spinoff)
- Path-alias introduction if not already in repo (per design D6)
