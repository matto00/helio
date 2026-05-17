# Tasks — Frontend decomposition closeout

## Cycle 1 — `models.ts` decomposition + test rename (mechanical)

### 1. Decompose `types/models.ts`
- [x] 1.1 Move dashboard types (`Dashboard`, `DashboardAppearance`, `DashboardLayout`, `DashboardLayoutItem`, `DashboardSnapshot*`, `DashboardUpdatePayload`, `UpdateDashboardBatchRequest`, `DuplicateDashboardResponse`) → `features/dashboards/types/dashboard.ts`
- [x] 1.2 Move panel-adjacent types (`ChartLegend`, `ChartTooltip`, `ChartAxisLabel`, `ChartAxisLabels`, `ChartAppearance`, `PanelAppearance`, `PanelBatchItem`, `UpdatePanelsBatchRequest`, `UpdatePanelsBatchResponse`, `MetricTypeConfig`, `ChartTypeConfig`, `ImageTypeConfig`, `DividerTypeConfig`, `TypeConfig`, `PanelUpdateFields`, `MappedPanelData`, `PanelPaginationState`) → extend `features/panels/types/panel.ts`
- [x] 1.3 Move `DataType`, `DataTypeField`, `ComputedField` → `features/dataTypes/types/dataType.ts`
- [x] 1.4 Move `Pipeline`, `PipelineSummary`, `RunStatus`, `RunStatusResponse`, `PipelineRunRecord` → extend `features/pipelines/types/pipelineStep.ts`
- [x] 1.5 Move `InferredField`, `StaticColumnType`, `StaticColumn`, `StaticSourcePayload` → extend `features/sources/types/dataSource.ts`
- [x] 1.6 Move `User`, `UserPreferences`, `UserPreferencePayload`, `AuthResponse`, `UpdateUserPreferenceRequest` → `features/auth/types/user.ts`
- [x] 1.7 Decide `ResourceMeta` disposition per design D7 — kept `types/models.ts` as 1-export survivor (recommendation (a))
- [x] 1.8 Delete re-export blocks (`export type {…}` from domain modules)

### 2. Update all 85 consumer imports
- [x] 2.1 Group consumers by source-domain (auth files, dashboard files, etc.)
- [x] 2.2 Update imports per consumer
- [x] 2.3 After each domain's updates, run `npm run build` to catch missed imports

### 3. Test rename
- [x] 3.1 Renamed `features/pipelines/ui/ComputedFieldPicker.test.tsx` → `features/panels/ui/PanelDetailModal.computedFields.test.tsx` (subject + scope name; moved to the SUT's folder)

### 4. Cycle 1 gates
- [x] 4.1 `sbt test` (backend untouched — sanity)
- [x] 4.2 `npm run lint` — zero warnings
- [x] 4.3 `npm run format:check` — clean
- [x] 4.4 `npm test` — 664 tests green (count preserved)
- [x] 4.5 `npm run build` — green
- [x] 4.6 `npm run check:schemas` — 6/6 in sync (unchanged)
- [x] 4.7 `npm run check:openspec` — clean
- [x] 4.8 `npm run check:scala-quality` — clean
- [x] 4.9 Pre-commit hook clean
- [x] 4.10 `models.ts` reduced to 19 lines (1 surviving cross-cutting export per D7 recommendation (a))
- [x] 4.11 Write `executor-report-1.md` — counts of types moved per domain, consumer-update count, models.ts final state, any circular-import surprises

## Cycle 2 — `PanelCreationModal` decomposition + `StepCard` investigation (creative)

### 5. `PanelCreationModal` per-subtype decomposition
- [x] 5.1 Create `features/panels/ui/creators/` folder
- [x] 5.2 Extract `MetricConfigFields` → `creators/MetricCreatorFields.tsx`
- [x] 5.3 Extract `ChartTypeField` → `creators/ChartCreatorFields.tsx`
- [x] 5.4 Extract `ImageConfigField` → `creators/ImageCreatorFields.tsx`
- [x] 5.5 Extract `DividerConfigField` → `creators/DividerCreatorFields.tsx`
- [x] 5.6 Extract shared props/types → `creators/creatorTypes.ts`
- [x] 5.7 Modal shell dispatches to creators (per-subtype dispatch like editors/renderers)
- [x] 5.8 Verify `PanelCreationModal.tsx` < 400L

### 6. `StepCard` per-kind split investigation
- [x] 6.1 Read `features/pipelines/ui/StepCard.tsx` body; per-kind dispatch found but per-kind wrappers would only be 3–10L shims around already-extracted config components — pure indirection
- [x] 6.2 Alternative natural decomposition adopted: lifted per-op editor state + PATCH-on-change handlers into `features/pipelines/hooks/useStepCardState.ts` (167L); StepCard.tsx 323L → 236L (under 250L soft cap)
- [x] 6.3 N/A — natural decomposition succeeded via the state hook (see 6.2)

### 7. Cycle 2 gates
- [x] 7.1 All cycle-1 gates re-run green
- [x] 7.2 File-size BLOCKER check: NO file >400L anywhere in frontend
- [ ] 7.3 Playwright Phase 3 smoke (evaluator scope) — panel creation flow for all 7 subtypes works; pipeline detail page renders
- [x] 7.4 Write `executor-report-2.md` — final line counts, StepCard decision + rationale, any drive-bys invoked

## Out of scope (do NOT touch)

- HEL-242 fix
- `useLegacyBoundPanel` removal
- `appearance.chart` → `ChartPanelConfig` migration
- Behavior changes to any file
- Backend, schemas
- Other soft-cap files (toastListeners 394L, PanelDetailModal 390L, App.tsx 348L) unless cycle 2 surfaces a clear reason
- Path-alias introduction
