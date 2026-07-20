## Backend

- `backend/src/main/scala/com/helio/domain/panels/TimelinePanel.scala` — new: `TimelineOptions` (`sort` asc/desc), `TimelinePanelConfig` (tolerant `decode` / strict `decodeCreate` / `Patch`), `TimelinePanel` case class + `Panel.Companion`, mirroring `CollectionPanel.scala`.
- `backend/src/main/scala/com/helio/domain/Panel.scala` — registers `TimelinePanel.Kind -> TimelinePanel.companion` in `Panel.Registry`; adds `PanelKind.Timeline`.
- `backend/src/main/scala/com/helio/domain/model.scala` — adds `PanelType.Timeline` to the parallel sealed trait (`fromString`/`asString`) that gates `PanelServiceHelpers.validatePanelType`.
- `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` — `encodeConfig`, `TimelineCreate` `CreateConfig` variant, `decodeCreateConfig`, `applyConfigPatch` dispatch for `timeline`.
- `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala` — `TimelineCreate` case in `buildNewPanel` (else `MatchError`) and in `dataTypeIdFromCreateConfig` (V41 pipeline-only-binding guard coverage — same bug class HEL-316 fixed for Text/Markdown).
- `backend/src/main/scala/com/helio/infrastructure/DashboardSnapshotRepository.scala` — `PanelConfigCodec.TimelineCreate` case in the snapshot-import panel-build match (else `MatchError` on dashboard import).
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — adds `"timeline"` to `DataPanelKinds` so `propose_dashboard`/`apply_proposal` treat it as a data panel requiring a flat `dataTypeId`, matching `collection`.
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — adds `timeline_options` column to `PanelTable`/`PanelRow`, `configColumnsOf`/`configColumnValuesOf` tuples.
- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala` — `timelineConfig`/`timelineOptionsColumn` read/write helpers; row→domain and domain→row dispatch for `TimelinePanel.Kind`.
- `backend/src/main/resources/db/migration/V58__panel_timeline_options.sql` — new nullable `timeline_options` JSONB column on `panels`.
- `backend/src/test/scala/com/helio/domain/PanelTypeSpec.scala` — `PanelType.fromString`/`asString`/round-trip coverage for `Timeline`.
- `backend/src/test/scala/com/helio/domain/PanelSpec.scala` — Registry/kind-string/exhaustiveness updates (8→9 kinds) plus a full `TimelinePanelConfig`/`PanelConfigCodec` test block mirroring the Collection block (tolerant decode, `decodeCreate` invalid-sort 400, absent-vs-null `Patch`, encode/decode round-trip).
- `backend/src/test/scala/com/helio/infrastructure/PanelRowMapperSpec.scala` — `domainToRow`/`rowToDomain` round-trip tests for a Timeline panel with `timelineOptions` set and with a NULL `timeline_options` column (defaults).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — `POST /api/panels` create + type-echo test for `timeline`; invalid-`sort` 400 test; dashboard export→import round-trip test preserving `timelineOptions.sort`.

## Contract (schemas + helio-mcp)

- `schemas/panel.schema.json` — `"timeline"` in the panel `type` enum, `oneOf` branch, and new `TimelineConfig`/`TimelineOptions` `$defs`.
- `schemas/create-panel-request.schema.json` — `"timeline"` in the `type` enum + `allOf` branch routing `config` to `TimelineConfig`.
- `schemas/update-panels-batch-request.schema.json` — `"timeline"` in the batch item `type` enum.
- `schemas/dashboard-proposal.schema.json` — `"timeline"` in `ProposalPanel.type` enum; updated `dataTypeId`/`config` descriptions.
- `helio-mcp/src/tools/write.ts` — `"timeline"` in `create_panel`/`bind_panel` type enums; updated tool descriptions with the `time`/`event` fieldMapping slots and `timelineOptions.sort`.
- `helio-mcp/src/tools/proposal.ts` — `"timeline"` in `DATA_PANEL_TYPES`/`PANEL_TYPES`; updated `propose_dashboard` description.
- `helio-mcp/src/types.ts` — updated `ProposalPanel` doc comment to mention timeline's `config` passthrough shape.
- `helio-mcp/src/helioApi.ts` — updated `createPanel`/`bindPanel` doc comments to mention `timeline`.

## Frontend — types + state

- `frontend/src/features/panels/types/panel.ts` — `PanelKind`/`Panel`/`PanelConfig` unions widened; `TimelineOptions`, `TimelinePanelConfig`, `TimelinePanel`, `emptyTimelineConfig`, `emptyConfigForKind` case.
- `frontend/src/features/panels/state/panelNarrowing.ts` — `isTimelinePanel`; `isBoundCapablePanel` includes `timeline`.
- `frontend/src/features/panels/state/panelSlots.ts` — `PANEL_SLOTS.timeline = [time, event]`.
- `frontend/src/features/panels/state/panelPayloads.ts` — `seedCreateConfig` `"timeline"` case; new `buildTimelinePatch`.
- `frontend/src/features/panels/state/panelThunks.ts` — new `updatePanelTimeline` thunk.
- `frontend/src/features/panels/state/panelsSlice.ts` — wires `updatePanelTimeline` into `extraReducers` + re-exports.
- `frontend/src/features/panels/services/panelService.ts` — new `updatePanelTimeline` service call.
- `frontend/src/features/panels/hooks/usePanelData.ts` — `timeline` joins `collection` in the table-parity (50-row) page-size bucket, not the silent 10-row default (same fix class as HEL-247 CR2).
- `frontend/src/features/panels/ui/mobilePanelHeights.ts` — `timeline` case (intrinsic height, no internal scroller).
- `frontend/src/features/dashboards/ui/ProposalReview.tsx` — `timeline` added to `DATA_PANEL_TYPES` (schema-drift-checked set).

## Frontend — UI

- `frontend/src/features/panels/ui/creationSteps/TypeSelectStep.tsx` — `timeline` type card (icon `faTimeline` + description).
- `frontend/src/features/panels/ui/renderers/TimelineRenderer.tsx` — new: vertical chronological event list (marker/connector/time/description), client-side sort by `timelineOptions.sort`, unbound/empty/single-row degradation.
- `frontend/src/features/panels/ui/renderers/TimelineRenderer.css` — new: marker/connector styling, container-query size scaling, long-description wrap.
- `frontend/src/features/panels/ui/editors/TimelineEditor.tsx` — new: DataType picker + `time`/`event` field-mapping slots (via `FieldMappingSlots`) + sort-direction segmented control.
- `frontend/src/features/panels/ui/PanelContent.tsx` — dispatches `TimelineRenderer` for `timeline` panels.
- `frontend/src/features/panels/ui/PanelDetailModal.tsx` — dispatches `TimelineEditor` for `timeline` panels.
- `frontend/src/features/panels/ui/PanelCreationPreview.tsx` — builds a preview `TimelinePanel` for the creation-modal live preview.
- `frontend/src/features/panels/ui/PanelCreationModal.tsx` — `timeline` added to `DATA_BOUND_TYPES` so the creation flow prompts for a DataType.
- `frontend/src/features/panels/ui/MobilePanelStack.css` — **(cycle 2 fix)** adds `.mobile-panel-stack__item--timeline` to the intrinsic-height override group (`container-type: inline-size; height: auto; flex-shrink: 0;`) and a `.mobile-panel-stack__item--timeline .panel-content--timeline { height: auto; overflow: visible; }` rule, mirroring `collection` exactly. Fixes the evaluator-found bug: the Timeline panel collapsed to 0px visible height in the phone-stack breakpoint (390×844) because `mobilePanelHeights.ts` already classified it as intrinsic but the CSS half of that policy was never wired.

## Frontend — tests

- `frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx` — new: ordering (asc/desc), connector suppression on the last entry, unbound/empty/single-row/long-description states.
- `frontend/src/features/panels/ui/editors/TimelineEditor.test.tsx` — new: field-mapping slot rendering + dirty tracking, sort-direction toggle + persisted save (mocked `panelService`, minimal Redux store).
- `frontend/src/features/panels/ui/MobilePanelStack.css.test.ts` — **(cycle 2 fix)** extends the intrinsic-height regression guard's `intrinsicKinds` array with `"timeline"`, plus a dedicated "timeline restores intrinsic sizing on its content body" test mirroring the existing `collection` case — locks in the cycle-2 fix so it can't silently regress.

## OpenSpec

- `openspec/changes/add-timeline-panel-type/tasks.md` — all tasks marked complete.
