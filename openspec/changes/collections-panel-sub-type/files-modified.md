# Files modified — collections-panel-sub-type (HEL-247)

## Backend — domain / persistence

- `backend/src/main/resources/db/migration/V57__panel_collection_options.sql` — new nullable `collection_options JSONB` column (V56 comment style; NULL = defaults).
- `backend/src/main/scala/com/helio/domain/panels/CollectionPanel.scala` — new: `CollectionPanelConfig` (D1), tolerant `decode`/`decodeCreate` (layout enum strict on create), absent-vs-null `Patch` (D8), `CollectionPanel` case class + companion.
- `backend/src/main/scala/com/helio/domain/Panel.scala` — register `CollectionPanel` in `Panel.Registry` + `PanelKind.Collection`.
- `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` — encode arm, `CollectionCreate` variant, `decodeCreateConfig` + `applyConfigPatch` collection dispatch.
- `backend/src/main/scala/com/helio/domain/model.scala` — second panel-kind enum: `PanelType.Collection` + `fromString`/`asString` (skeptic CR1).
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — `collection_options` in `PanelTable`, `PanelRow`, `configColumnsOf`/`configColumnValuesOf`, HList projection.
- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala` — BOTH directions: `collectionConfig(row)` read arm + `case cp: CollectionPanel` write arm + `collectionOptionsColumn` serializer (D8 sibling-bug guard).
- `backend/src/main/scala/com/helio/infrastructure/DashboardSnapshotRepository.scala` — `CollectionCreate` arm in the snapshot-import create match (exhaustiveness).
- `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala` — `CollectionCreate` arm in `buildNewPanel` + `dataTypeIdFromCreateConfig` (binding-required validation).
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — `"collection"` added to `DataPanelKinds` (agent-proposal binding validation).

## Contract

- `schemas/panel.schema.json` — `collection` in the type enum, oneOf variant, `$defs.CollectionConfig` (+ `CollectionItemOptions`/`CollectionMetricItemOptions`; `baseType` enum `["metric"]`).

## Frontend — model + state

- `frontend/src/features/panels/types/panel.ts` — `PanelKind` + `CollectionLayout`/`CollectionPanelConfig`/`CollectionPanel` + `emptyCollectionConfig` + `emptyConfigForKind` arm.
- `frontend/src/features/panels/state/panelNarrowing.ts` — `isCollectionPanel` + collection joins `isBoundCapablePanel`.
- `frontend/src/features/panels/state/panelPayloads.ts` — explicit `collection` `seedCreateConfig` arm (HEL-305 lesson) + `buildCollectionPatch` (absent-vs-null).
- `frontend/src/features/panels/state/panelSlots.ts` — `collection: []` entry (editor derives slots from `PANEL_SLOTS[baseType]`).
- `frontend/src/features/panels/state/panelTemplates.ts` — curated "Metric Collection" starter template.
- `frontend/src/features/panels/services/panelService.ts` — `updatePanelCollection` service call.
- `frontend/src/features/panels/state/panelThunks.ts` — `updatePanelCollection` thunk.
- `frontend/src/features/panels/state/panelsSlice.ts` — import, `fulfilled` reducer sync, re-export.

## Frontend — rendering

- `frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx` (+ `.css`) — new: rows→items via shared mapping, reuse `MetricRenderer`, literal `itemOptions.metric` overrides, grid (auto-fill minmax ~140px) + list layouts, unbound/no-data states, desktop internal vertical scroll (D4).
- `frontend/src/features/panels/ui/PanelContent.tsx` — collection dispatch arm (rawRows/headers fetch path).
- `frontend/src/features/panels/hooks/usePanelData.ts` — explicit `case "collection"` → 50 initial page size (skeptic CR2).
- `frontend/src/features/panels/ui/mobilePanelHeights.ts` — explicit commented `collection` case → intrinsic, no internal scroll (D5).

## Frontend — creation + editor

- `frontend/src/features/panels/ui/creationSteps/TypeSelectStep.tsx` — Collection type card (faLayerGroup).
- `frontend/src/features/panels/ui/PanelCreationModal.tsx` — `"collection"` in `DATA_BOUND_TYPES`.
- `frontend/src/features/panels/ui/PanelCreationPreview.tsx` — collection preview arm.
- `frontend/src/features/panels/ui/editors/CollectionEditor.tsx` — new: base-type control (single option, extension point), DataType binding, value bind-only + label/unit `BoundOrLiteralField`, grid/list segmented control; single `updatePanelCollection` PATCH on save (D7).
- `frontend/src/features/panels/ui/PanelDetailModal.tsx` — collection editor wiring (ref + `renderSubtypeEditor` + `activeEditorRef`).
- `frontend/src/features/panels/ui/PanelDetailModal.css` — `__segmented`/`__segmented-btn` styles + `@media (max-width: 768px)` ≥44px extension for the layout control (DESIGN.md tokens throughout).

## Tests

- Backend: `PanelSpec.scala` (registry parity/exhaustiveness + collection decode/patch/codec), `PanelTypeSpec.scala` (collection round-trip), `PanelRowMapperSpec.scala` (create→duplicate→read round-trip, NULL→defaults, non-active-key preservation).
- Frontend: `CollectionRenderer.test.tsx`, `panelPayloads.test.ts` (seed carries baseType/layout; patch builder), `mobilePanelHeights.test.ts` (collection case), `panelNarrowing.collection.test.ts`, `PanelDetailModal.collection.test.tsx` (editor save patch), `PanelDetailModal.css.test.ts` (segmented mobile touch target), `PanelCreationModal.test.tsx` (card + datatype step), `test/panelFixtures.ts` (`makeCollectionPanel`).

## Notes / deviations

- No bugs fixed this run (no systematic-debugging probes required — all gates green on first full run after implementation).
- Proposal path: a collection proposed by an agent flows through the existing `buildDataConfig` (`{dataTypeId, fieldMapping}`), which the tolerant `decodeCreate` resolves to metric/grid defaults — no proposal-service config-build arm was needed.
- No `git commit -n` bypass used: `check:openspec` and `check:scala-quality` both pass (scala-quality reports only pre-existing informational soft-budget warnings).
