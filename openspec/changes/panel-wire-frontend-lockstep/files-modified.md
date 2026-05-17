# Files modified — CS2c-3c

Cycle 1 shipped backend + schemas; cycle 2 (this section's additions) ships
the frontend lockstep so consumers narrow on a discriminated `Panel` union.

## Backend — domain panels (per-subtype Patch decoders + applyPatch) — CYCLE 1

- `backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala` — added `Patch` ADT + `decodeCreate` + `applyPatch`
- `backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala` — same
- `backend/src/main/scala/com/helio/domain/panels/TablePanel.scala` — same
- `backend/src/main/scala/com/helio/domain/panels/TextPanel.scala` — same
- `backend/src/main/scala/com/helio/domain/panels/MarkdownPanel.scala` — same
- `backend/src/main/scala/com/helio/domain/panels/ImagePanel.scala` — Patch with `imageFit` allow-list validation at decode time
- `backend/src/main/scala/com/helio/domain/panels/DividerPanel.scala` — Patch with `orientation` allow-list validation at decode time
- `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` — NEW — single dispatcher between wire `(type, config)` and typed ADT

## Backend — protocol / service / repository (write + read path) — CYCLE 1

- `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala` — `PanelResponse` / `CreatePanelRequest` / `UpdatePanelRequest` / `PanelBatchItem` collapsed to `type` + typed `config`
- `backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala` — `DashboardSnapshotPanelEntry` collapsed to `type` + typed `config`; added `DashboardSnapshotPayload.CurrentVersion = 2`
- `backend/src/main/scala/com/helio/services/PanelService.scala` — `resolvePatch` enforces cross-type 400 lock; `resolveCreateConfig` decodes typed create payload; `buildNewPanel` dispatches per-subtype CreateConfig
- `backend/src/main/scala/com/helio/services/PanelPatchApplier.scala` — rewritten to apply title → appearance → typed config (via `PanelConfigCodec.applyConfigPatch`)
- `backend/src/main/scala/com/helio/services/DashboardService.scala` — snapshot validation rejects prior version with descriptive error; validates each entry's typed config
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — added `replace(panel, lastUpdated)` for typed-config writeback; `batchUpdate` consumes typed `config` patch
- `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala` — import path reconstructs Panel via `PanelConfigCodec.decodeCreateConfig`; export tags `CurrentVersion`

## Backend — tests — CYCLE 1

- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — updated all `CreatePanelRequest`, `UpdatePanelRequest`, `PanelBatchItem`, `DashboardSnapshotPanelEntry` to the new wire shape; switched flat-field assertions to `config.asJsObject.fields(...)` reads; `snapshot.version` now compared to `CurrentVersion`
- `backend/src/test/scala/com/helio/api/protocols/AggregatorRegressionSpec.scala` — `PanelResponse` and `DashboardSnapshotPayload` round-trips updated for the new shape
- `backend/src/test/scala/com/helio/services/DashboardSnapshotValidationSpec.scala` — rewrote the version-rejection case (now rejects prior versions, not `< 1`); uses `JsObject.empty` for entry configs

## Schemas — CYCLE 1

- `schemas/panel.schema.json` — `oneOf` discriminator + per-subtype `$defs` (MetricConfig / ChartConfig / TableConfig / TextConfig / MarkdownConfig / ImageConfig / DividerConfig)
- `schemas/create-panel-request.schema.json` — `allOf` + `if/then` over `type` to select the matching `$ref` config shape
- `schemas/update-panels-batch-request.schema.json` — entry shape gains `config` typed payload

## Frontend — types (extractions + union) — CYCLE 2

- `frontend/src/types/panel.ts` — NEW — `Panel` discriminated union + per-subtype config types + default config factories
- `frontend/src/types/dataSource.ts` — NEW — pre-existing DataSource ADT extracted to keep `models.ts` under the 400L hard cap (re-exported from `models.ts`)
- `frontend/src/types/pipelineStep.ts` — NEW — pre-existing PipelineStep ADT extracted for the same reason
- `frontend/src/types/models.ts` — removed flat `Panel` interface; re-exports the new ADTs; `DashboardSnapshotPanelEntry` collapsed to `{ type, appearance, config? }`; `PanelBatchItem` gains optional `config`; `PanelUpdateFields.type` retyped to `PanelKind`

## Frontend — panels slice (extractions + thunks + payload builders) — CYCLE 2

- `frontend/src/features/panels/panelsSlice.ts` — collapsed to reducer + `accumulatePanelUpdate` + `buildBatchRequest`; re-exports thunks and `markDashboardPanelsStale` so existing imports keep working
- `frontend/src/features/panels/panelThunks.ts` — NEW — all `createAsyncThunk` definitions (create/update/binding/content/image/divider/batch/fetchPanelPage)
- `frontend/src/features/panels/panelActions.ts` — NEW — `markDashboardPanelsStale` as a standalone `createAction` to avoid a cyclic import between the slice and `panelThunks`
- `frontend/src/features/panels/panelNarrowing.ts` — NEW — narrowing predicates (`isMetricPanel`, etc.) + read-only accessors (`getDataTypeId`, `getFieldMapping`, `getContent`, `getImageUrl`, etc.)
- `frontend/src/features/panels/panelPayloads.ts` — NEW — typed request body builders (`buildCreatePanelBody`, `buildBindingPatch`, `buildContentPatch`, `buildImagePatch`, `buildDividerPatch`, `buildBatchItem`)

## Frontend — panel detail modal (extractions + dispatcher shell) — CYCLE 2

- `frontend/src/components/PanelDetailModal.tsx` — collapsed to a discriminator-dispatched shell that owns the mode toggle + unified appearance state; per-subtype editors mount conditionally via `is*Panel` narrowing
- `frontend/src/components/panels/editors/editorTypes.ts` — NEW — shared `PanelEditorHandle` + `DirtyChangeCallback`
- `frontend/src/components/panels/editors/AppearanceEditor.tsx` — NEW — common appearance form (title / bg / color / transparency / chart shim)
- `frontend/src/components/panels/editors/ChartAppearanceEditor.tsx` — NEW — chart-specific appearance subsection
- `frontend/src/components/panels/editors/BindingEditor.tsx` — NEW — metric/chart/table binding section (data type + field mapping + refresh)
- `frontend/src/components/panels/editors/MarkdownEditor.tsx` — NEW
- `frontend/src/components/panels/editors/ImageEditor.tsx` — NEW
- `frontend/src/components/panels/editors/DividerEditor.tsx` — NEW
- `frontend/src/hooks/usePanelDetailModalLifecycle.ts` — NEW — dialog ref + cancel/click/keydown listener wiring

## Frontend — panel grid (extractions + dispatcher) — CYCLE 2

- `frontend/src/components/PanelGrid.tsx` — slimmed; layout config / save-pipeline moved to the new hook + config file; PanelCardBody now passes `panel` (not flat fields) to `PanelContent`
- `frontend/src/components/panelGridConfig.ts` — NEW — static layout config (`panelGridConfig`, `createLayouts`, `fromResponsiveLayouts`)
- `frontend/src/hooks/usePanelGridSave.ts` — NEW — 30s auto-save interval, pending-batch flush, layout-persist pipeline, SaveState context wiring, imperative `flushAndReset` handle

## Frontend — panel content (discriminator-dispatched + renderers) — CYCLE 2

- `frontend/src/components/PanelContent.tsx` — rewritten as a discriminator shell; takes a `panel` plus optional `data` / `rawRows` / `headers` / pagination props; dispatches to one of 7 renderers
- `frontend/src/components/panels/renderers/MetricRenderer.tsx` — NEW
- `frontend/src/components/panels/renderers/TextRenderer.tsx` — NEW
- `frontend/src/components/panels/renderers/TableRenderer.tsx` — NEW
- `frontend/src/components/panels/renderers/ChartRenderer.tsx` — NEW (wraps existing ChartPanel view)
- `frontend/src/components/panels/renderers/MarkdownRenderer.tsx` — NEW (wraps existing MarkdownPanel view, narrows on `panel.config.content`)
- `frontend/src/components/panels/renderers/ImageRenderer.tsx` — NEW (wraps existing ImagePanel view, narrows on `panel.config.imageUrl` / `imageFit`)
- `frontend/src/components/panels/renderers/DividerRenderer.tsx` — NEW (wraps existing DividerPanel view, narrows on `panel.config.orientation` / `weight` / `color`)
- `frontend/src/components/PanelCreationPreview.tsx` — constructs a synthetic `Panel` for the preview; passes through to `PanelContent`

## Frontend — service layer — CYCLE 2

- `frontend/src/services/panelService.ts` — every PATCH now sends `{ config: <typed config> }`; create sends `{ dashboardId, title, type, config }` via `buildCreatePanelBody`; `refreshInterval` is dropped at the network boundary (no backend column)

## Frontend — consumer-site migrations — CYCLE 2

- `frontend/src/hooks/useLegacyBoundPanel.ts` — `panel.typeId` → `getDataTypeId(panel)`. Hook preserved as-is per CS3-era cleanup guard.
- `frontend/src/hooks/usePanelData.ts` — `panel.typeId` / `panel.fieldMapping` → narrowed accessors; cache-key shape preserved (HEL-242 non-regression)
- `frontend/src/components/DataSourceList.tsx` — `p.typeId === relatedType.id` → `getDataTypeId(p) === relatedType.id`

## Frontend — tests + fixtures — CYCLE 2

- `frontend/src/test/panelFixtures.ts` — NEW — fluent factories per subtype (`makeMetricPanel`, `makeChartPanel`, `makeTablePanel`, `makeTextPanel`, `makeMarkdownPanel`, `makeImagePanel`, `makeDividerPanel`) that take partial overrides and emit typed-config panels
- `frontend/src/features/panels/panelsSlice.test.ts` — migrated to fixtures; binding-thunk assertion now reads `panel.config.dataTypeId`
- `frontend/src/hooks/useLegacyBoundPanel.test.ts` — fixtures + config-side `dataTypeId`
- `frontend/src/hooks/usePanelData.test.ts` — fixtures + config-side `dataTypeId` / `fieldMapping`
- `frontend/src/features/dashboards/dashboardLayout.test.ts` — fixtures
- `frontend/src/components/PanelContent.test.tsx` — rewritten for the new `panel` prop API; preserves all scenarios
- `frontend/src/components/PanelCreationModal.test.tsx` — fixtures + mock return shapes
- `frontend/src/components/PanelDetailModal.test.tsx` — fixtures across all subtypes
- `frontend/src/components/ComputedFieldPicker.test.tsx` — fixtures
- `frontend/src/components/PanelGrid.test.tsx` — fixtures
- `frontend/src/components/PanelList.test.tsx` — bulk migration of flat-field literals to `config: { … }` objects
- `frontend/src/app/App.test.tsx` — bulk migration + one base panel switched to fixtures

## OpenSpec change folder

- `openspec/changes/panel-wire-frontend-lockstep/{ticket.md,proposal.md,design.md,tasks.md,workflow-state.md,.openspec.yaml,specs/*/spec.md}` — planning artifacts (cycle 1)
- `openspec/changes/panel-wire-frontend-lockstep/executor-report-1.md` — cycle 1 report (BLOCKER + split decision)
- `openspec/changes/panel-wire-frontend-lockstep/executor-report-2.md` — cycle 2 report (this cycle)
- `openspec/changes/panel-wire-frontend-lockstep/files-modified.md` — this file (updated for cycle 2)
