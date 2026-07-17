## Why

Showing "one metric per region" today means manually creating and binding N separate panels. A
Collection panel binds once to a multi-row DataType and renders one item per row, scaling with the
data (HEL-247).

## What Changes

- New `collection` panel kind: N homogeneous items of one base type, bound to a multi-row DataType;
  one row = one rendered item.
- Collection config carries: base type discriminator, shared field mapping, layout (`grid` | `list`),
  and per-base-type item options keyed by base type (HEL-248 `chartOptions` keying precedent) — so
  adding future base types (image, markdown) is a code-only change, **no schema changes**.
- Ships with `metric` as the only base type; item rendering reuses the Metric visual language.
- Full persistence chain per V53/V55/V56 precedent: TS types, `panel.schema.json`, Scala domain ADT,
  `PanelConfigCodec`, `PanelRowMapper` (both directions), `configColumnsOf`, Flyway `V57` (one
  nullable JSONB column `collection_options`; NULL = defaults).
- Creation modal: Collection type card; routed through the DataType picker step (data-bound kind).
- Detail modal: Collection editor built on the HEL-243 `BoundOrLiteralField` family; ≥44px touch
  targets at ≤768px per the HEL-245/255/248 CSS pattern.
- Mobile stack: explicit `collection` entry in the per-kind height policy; no horizontal overflow
  at 390px.

## Non-goals

- Heterogeneous (mixed-type) collections; drag-to-reorder within a collection; per-item config
  overrides; base types beyond Metric (design for them, don't ship them).

## Capabilities

### New Capabilities

- `collection-panel-type`: the `collection` kind — config shape, persistence, wire contract,
  base-type extensibility rule.
- `collection-panel-rendering`: row→item expansion, grid/list layouts, empty/unbound states,
  overflow behavior.
- `collection-config-editor`: detail-modal editor (base type, binding + shared field mapping,
  layout, mobile touch targets).

### Modified Capabilities

- `panel-type-field`: `collection` joins the valid persisted `type` values.
- `panel-type-picker-cards`: Collection card joins the creatable set.
- `panel-creation-datatype-step`: `collection` is a data-bound kind (DataType step required).
- `mobile-panel-sizing`: per-kind height policy gains an explicit `collection` entry.

(Collection body rendering is fully owned by the new `collection-panel-rendering` capability, so the
existing `panel-type-rendering` spec is not modified.)

## Impact

- Frontend: `features/panels/types/panel.ts`, `panelNarrowing`, `panelPayloads`, `panelSlots`,
  `PanelCreationModal` + steps/creators, `PanelContent`, new `renderers/CollectionRenderer`,
  `editors/` (new Collection editor), `PanelDetailModal(.css)`, `mobilePanelHeights.ts`,
  `usePanelData.ts` (explicit per-kind initial page size for `collection`).
- Backend: `domain/panels/CollectionPanel.scala` (new), `Panel.Registry`, `PanelConfigCodec`,
  `PanelRowMapper`, `PanelRepository`/`PanelMutationRepository` (`configColumnsOf`), protocols,
  Flyway `V57`; **plus the second panel-kind enum and its call sites**: `domain/model.scala`
  (`sealed trait PanelType`), `PanelServiceHelpers` (`validatePanelType`, `buildNewPanel`),
  `DashboardServiceValidation.validatePanelEntries` (import path),
  `DashboardProposalService.DataPanelKinds` (agent proposal path).
- Contract: `schemas/panel.schema.json` collection variant + `$defs`.
- No API route changes; no breaking changes (existing rows untouched, NULL column default).
