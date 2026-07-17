# Tasks — collections-panel-sub-type (HEL-247)

## 1. Backend

- [x] 1.1 Flyway `V57__panel_collection_options.sql`: nullable `collection_options JSONB` (V56 comment style)
- [x] 1.2 `domain/panels/CollectionPanel.scala`: config (D1) + tolerant `decode`/`decodeCreate` + `Patch` (D8) + companion
- [x] 1.3 Register in `Panel.Registry`; add `CollectionCreate` + all three `PanelConfigCodec` dispatch arms
- [x] 1.4 `PanelRepository`: `collection_options` in `PanelTable`, `PanelRow`, and `configColumnsOf` (both repos)
- [x] 1.5 `PanelRowMapper`: `collectionConfig(row)` read arm AND `domainToRow` write arm (BOTH directions, D8)
- [x] 1.6 Wire protocols/validation as needed so create/PATCH/duplicate round-trip `collection` panels
- [x] 1.7 Second kind enum (skeptic CR1): `domain/model.scala` `case object Collection` + `fromString`/`asString`;
      `PanelServiceHelpers.buildNewPanel` gains the `CollectionCreate` arm (sealed match)
- [x] 1.8 `DashboardServiceValidation.validatePanelEntries` accepts `collection` (import path);
      `DashboardProposalService.DataPanelKinds` gains `"collection"` (binding-required proposal validation)

## 2. Contract

- [x] 2.1 `schemas/panel.schema.json`: `collection` in the type enum, variant mapping, `$defs.CollectionConfig`
      (baseType enum `["metric"]`, layout enum, itemOptions keyed per base type)

## 3. Frontend — model + state

- [x] 3.1 `types/panel.ts`: `PanelKind` + `CollectionPanelConfig` + `CollectionPanel` + `emptyCollectionConfig`
      (baseType "metric", layout "grid") + `emptyConfigForKind` arm
- [x] 3.2 `panelNarrowing.ts`: `isCollectionPanel` + binding getters cover collection
- [x] 3.3 `panelPayloads.ts`: explicit `collection` arm in `seedCreateConfig` (D6, HEL-305 lesson) +
      `buildCollectionPatch` with absent-vs-null (D7)
- [x] 3.4 `panelSlots.ts`: `collection: []` entry; editor derives item slots from `PANEL_SLOTS[baseType]` (D2)
- [x] 3.5 `panelTemplates.ts` + creation flow: Collection card in `TypeSelectStep`, `DATA_BOUND_TYPES` gains
      `"collection"`, blank template entry, `PanelCreationPreview` arm

## 4. Frontend — rendering

- [x] 4.1 `renderers/CollectionRenderer.tsx` + CSS: rows→items via shared mapping, reuse `MetricRenderer`,
      literal `itemOptions.metric` overrides, grid (auto-fill minmax, ~140px min) + list layouts, unbound/no-data
      states, desktop internal vertical scroll (D4)
- [x] 4.2 `PanelContent.tsx`: collection dispatch arm (fetch path = rawRows/headers like table)
- [x] 4.2b `usePanelData.ts`: explicit `case "collection"` in the initial page-size switch → 50, table parity
      (skeptic CR2 — never the silent 10-row else bucket)
- [x] 4.3 `mobilePanelHeights.ts`: explicit `case "collection"` → intrinsic, no internal scroll, commented (D5)

## 5. Frontend — editor

- [x] 5.1 `editors/CollectionEditor.tsx` (+ binding fields): base-type control (single option, extension point),
      DataType binding, slots from `PANEL_SLOTS["metric"]` — value bind-only, label/unit via
      `BoundOrLiteralField`/`useBoundOrLiteralState`, grid/list segmented control (D7)
- [x] 5.2 `PanelDetailModal.tsx`: collection editor wiring; save issues one `buildCollectionPatch` PATCH
- [x] 5.3 `PanelDetailModal.css`: extend the `@media (max-width: 768px)` ≥44px block to new controls (DESIGN.md
      tokens throughout); clean trivial style debt in touched files

## 6. Tests

- [x] 6.1 Backend: CollectionPanel decode/patch (fields ABSENT not just null), codec dispatch, 400 on unknown type
      unchanged, create→duplicate→read round-trip preserves `collection_options` (D8 sibling-bug guard);
      `PanelTypeSpec` covers `collection` fromString/asString round-trip; import-validation accepts collection
- [x] 6.2 Frontend unit: payload seed/patch builders (creation payload carries baseType/layout explicitly),
      narrowing, `mobilePanelHeights` collection case, slots
- [x] 6.3 Frontend component: CollectionRenderer (N rows → N items, literal overrides, layouts, empty states),
      PanelContent dispatch, creation modal flow (card → datatype step), CollectionEditor save patch
- [x] 6.4 CSS-lock tests: `PanelDetailModal.css` mobile touch targets; collection renderer grid rules if locked
- [x] 6.5 Gates: `npm run lint`, `npm test`, `npm run build`, `sbt test`; manual UI pass desktop + 390×844
      read-only (HEL-304), screenshots to scratchpad only
