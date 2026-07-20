## 1. Backend — domain + codec

- [x] 1.1 Add `domain/panels/TimelinePanel.scala`: `TimelinePanelConfig` (dataTypeId, fieldMapping, timelineOptions with `sort`), tolerant `decode` + strict `decodeCreate` (reject invalid `sort`), `Patch` with absent-vs-null semantics, `TimelinePanel` case class, and companion (`Kind = "timeline"`, wire codec) — mirroring `CollectionPanel.scala`
- [x] 1.2 Register `timeline` in `Panel.Registry` (`domain/Panel.scala`)
- [x] 1.3 Wire `timeline` into `PanelConfigCodec`: `encodeConfig`, `TimelineCreate` `CreateConfig` variant + `decodeCreateConfig`, `applyConfigPatch`
- [x] 1.4 Wire `timeline` into `PanelProtocol` and any `JsonProtocols` panel dispatch
- [x] 1.5 Add `case object Timeline` to the parallel `PanelType` sealed trait in `domain/model.scala` (with `"timeline"` in `fromString` and `asString`) — this gates `PanelServiceHelpers.validatePanelType` at the top of `PanelService.create`, so `POST /api/panels` 400s without it

## 2. Backend — service layer wiring

- [x] 2.1 Add a `TimelineCreate` case to `PanelServiceHelpers.buildNewPanel` constructing `TimelinePanel(...)`, mirroring `CollectionCreate` (else non-exhaustive match / runtime `MatchError`)
- [x] 2.2 Add a `TimelineCreate` case to `PanelServiceHelpers.dataTypeIdFromCreateConfig` (mirroring `CollectionCreate`) so the V41 pipeline-only-binding guard (`rejectCompanionBinding`) runs against a timeline panel's `dataTypeId` — binding-safety, same bug class HEL-316 fixed for Text/Markdown
- [x] 2.3 Verify `DashboardServiceValidation.validatePanelEntries` (dashboard import) accepts `timeline` once 1.5 lands (it calls `PanelType.fromString` + `decodeCreateConfig`) — no code change expected beyond 1.5

## 3. Backend — persistence

- [x] 3.1 Add Flyway migration `V58__panel_timeline_options.sql` adding a nullable `timeline_options` JSONB column
- [x] 3.2 Extend `PanelRowMapper` (row→domain and domain→row) to persist/read `timeline_options`, mirroring `collection_options`

## 4. Contract — schema + MCP

- [x] 4.1 Add `"timeline"` to the `schemas/panel.schema.json` panel `type` enum and a `TimelineConfig` `$def` (dataTypeId, fieldMapping, timelineOptions.sort enum asc/desc)
- [x] 4.2 Add `"timeline"` to the helio-mcp `create_panel` and `bind_panel` tool type enums and update fieldMapping help text (`time` / `event` slots)

## 5. Frontend — types + wiring

- [x] 5.1 Extend `types/panel.ts`: `PanelKind`, `TimelinePanelConfig`, `TimelinePanel`, `Panel`/`PanelConfig` unions, `emptyTimelineConfig`, `emptyConfigForKind`
- [x] 5.2 Add `isTimelinePanel` to `panelNarrowing.ts` and include timeline in the bound-panel narrowing where appropriate
- [x] 5.3 Add timeline handling to `panelPayloads.ts`, `panelSlots.ts` (`time` + `event` slots), and `mobilePanelHeights.ts`

## 6. Frontend — UI

- [x] 6.1 Add the `timeline` card (icon + one-line description) to `creationSteps/TypeSelectStep.tsx`
- [x] 6.2 Add `renderers/TimelineRenderer.tsx` + `TimelineRenderer.css`: vertical marker/connector/time/description list, client-side sort, single-row/empty/long-text degradation, size-proportional scaling
- [x] 6.3 Add `editors/TimelineEditor.tsx`: `time` + `event` field mapping slots and a `sort` direction control
- [x] 6.4 Dispatch timeline in `PanelContent.tsx`, `PanelDetailModal.tsx`, and `PanelCreationPreview.tsx`

## 7. Tests

- [x] 7.1 Backend: `TimelinePanel` config decode/patch/round-trip + create-path invalid-sort rejection + mapper duplication/export parity
- [x] 7.2 Backend: dashboard export→import round-trip for a timeline panel (exercises the `DashboardServiceValidation` / `PanelType.fromString` import path, distinct from `duplicate`)
- [x] 7.3 Frontend: `TimelineRenderer` (ordering, empty/single-row/long-text) and `TimelineEditor` (slot mapping + sort) tests
- [x] 7.4 Run full gates: `sbt test`, `npm test`, `npm run lint`, `npm run format:check`, `openspec validate add-timeline-panel-type`
