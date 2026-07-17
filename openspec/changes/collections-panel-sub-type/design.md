# Design — collections-panel-sub-type (HEL-247)

## Context

The panel system is a discriminated-union ADT on both sides of the wire (`frontend/src/features/panels/types/panel.ts`
mirroring `backend/src/main/scala/com/helio/domain/panels/*Panel.scala`, dispatched by `PanelConfigCodec` and
`PanelRowMapper`). Config storage extensions follow the V53/V55/V56 precedent: one nullable column per concern, NULL =
pre-change behavior, tolerant read path. A Collection is a new eighth kind: bound to a multi-row DataType, rendering one
homogeneous item per row. Binding constraint: adding future base types must require **no schema changes**.

## Goals / Non-Goals

**Goals:** `collection` kind end-to-end (create, persist, render, edit, duplicate, mobile); Metric as the only shipped
base type; config shape extensible to future base types by code only. **Non-goals:** heterogeneous collections,
reorder-within-collection, per-item overrides, shipping image/markdown base types, per-collection pagination UX.

## Decisions

### D1 — Config shape: binding reuses existing columns; one new JSONB column for collection concerns

`CollectionPanelConfig` (wire, both languages):

```ts
interface CollectionPanelConfig {
  dataTypeId: string;                       // reuses panels.type_id
  fieldMapping: Record<string, string>;     // reuses panels.field_mapping — shared across all items
  baseType: string;                         // "metric" for now — see D2
  layout: "grid" | "list";                  // default "grid"
  itemOptions?: { metric?: { label?: string; unit?: string } } | null;  // keyed per base type — see D3
}
```

Persistence: Flyway `V57__panel_collection_options.sql` adds a single nullable `collection_options JSONB` column
storing `{ baseType, layout, itemOptions }` (binding stays in `type_id`/`field_mapping` so the bound-trio machinery —
`buildQuery`, `withBindingCleared`, freshness — works unchanged). One concern per column, exactly the V56
`chart_options` precedent. Alternative (separate `base_type`/`layout` text columns) rejected: more columns for the same
concern and any future per-base-type option would need another migration, violating the extensibility constraint.

### D2 — Base type values are existing `PanelKind` strings; unknown values tolerated on read

`baseType` is a plain string on the wire whose valid set is code-defined (schema `enum: ["metric"]` today; widening an
enum is a schema-file edit, not a DB change). Using `PanelKind` names lets the editor derive field-mapping slots from
the existing `PANEL_SLOTS[baseType]` table (`panelSlots.ts`) — a new base type later means adding a renderer arm + an
editor arm + widening the schema enum. Read path is tolerant per `PanelRowMapper` philosophy: malformed/unknown
`collection_options` decodes to defaults (`baseType: "metric"`, `layout: "grid"`), never a 500.

### D3 — `itemOptions` keyed per base type (HEL-248 `chartOptions` keying precedent)

Shared literal overrides live under `itemOptions.<baseType>` — for Metric: literal `label`/`unit` (HEL-243 semantics:
literal overrides the bound `fieldMapping.label`/`unit` column, identical to `MetricPanelConfig.label/unit`). Keying
per base type means a future base-type switch preserves the other type's options (nothing destroyed), and new base
types add a key, not a column.

### D4 — Rendering: map each fetched row through the shared mapping; reuse `MetricRenderer`

`CollectionRenderer` consumes `usePanelData`'s `rawRows` + `headers` (the table path), builds one `MappedPanelData` per
row via `fieldMapping` (applying `itemOptions.metric` literal overrides), and renders one `MetricRenderer` per row —
items get the exact Metric visual language for free (`panel-content--metric` classes). Layouts: `grid` =
`repeat(auto-fill, minmax(clamped-min, 1fr))` so columns wrap responsively (no horizontal overflow at 390px); `list` =
single column with a hairline divider between items. Desktop overflow: the collection body scrolls vertically inside
the panel (table precedent). v1 renders the first fetched page of rows; the initial page size is a deliberate,
explicit `case "collection"` in `usePanelData.ts`'s per-kind page-size switch set to **50 (table parity)** — NOT the
silent 10-row `else` bucket, which would cap "one metric per region" collections accidentally. No load-more UX inside
a panel. Empty states: unbound → the standard unbound placeholder; bound with zero rows → "No data" state.

### D5 — Mobile stack: `collection` is intrinsic-height, no internal scroll

`mobilePanelHeights.ts` gains an explicit `case "collection"` → `{ height: null, scrollsInternally: false }`. W4.3's
rule is "only table gets a nested scroller"; a collection is tile content like metric/markdown, so it sizes to content
and the grid wraps (2-up at ~390px content widths via the same auto-fill minmax). Deliberate, commented — not a
fall-through default. Verification is read-only at <768px (HEL-304: appearance edits are dropped there).

### D6 — Creation flow: card + DataType step; explicit seed config; no step-3 fields

`TypeSelectStep` gains a Collection card; `DATA_BOUND_TYPES` in `PanelCreationModal.tsx` gains `"collection"` (the
DataType step is required — a collection is meaningless unbound). `seedCreateConfig` in `panelPayloads.ts` gets an
explicit `collection` arm returning `{ dataTypeId, fieldMapping: {}, baseType: "metric", layout: "grid" }` — creation
fields carried explicitly and payload-tested (HEL-305 lesson: do NOT rely on `typeConfig` passthrough). No step-3
creator fields: base type has exactly one option today and layout is editable in the detail modal, so `TypeConfig`
union and `panel-creation-type-config` spec are untouched.

### D7 — Editor: Collection arm in `PanelDetailModal` built on the HEL-243 family

New `CollectionEditor` composes: base-type select (single `metric` option, disabled-with-explanation — the extension
point is visible), DataType binding (existing `DataTypePicker`/`BindingEditor` pattern), shared field-mapping slots
from `PANEL_SLOTS["metric"]` using `BoundOrLiteralField`/`useBoundOrLiteralState` for label/unit (value is bound-only),
and a grid/list layout segmented control. Save issues one config PATCH via a new `buildCollectionPatch` following
`buildBindingPatch`'s absent-vs-null convention. Mobile: extend the existing `@media (max-width: 768px)` block in
`PanelDetailModal.css` (≥44px touch targets) and its CSS-lock test to the new controls.

### D8 — Backend ADT: `CollectionPanel.scala` mirrors `MetricPanel.scala` exactly

Companion in `Panel.Registry`; `CollectionCreate` variant + decode arm in `PanelConfigCodec` (all three dispatch
points); `Patch` with absent-vs-null (`baseType`/`layout` as `Option[Option[String]]`, `itemOptions` as
`Option[Option[JsObject]]`); `buildQuery` = selected fields from mapping, no limit (metric precedent);
`withBindingCleared` → `Empty`. `PanelRowMapper`: `collectionConfig(row)` on read AND a `case cp: CollectionPanel`
arm in `domainToRow` writing `collection_options` (+ `type_id`/`field_mapping`) — BOTH directions, plus
`configColumnsOf` in `PanelRepository`/`PanelMutationRepository`; the HEL-245/248 sibling bugs were exactly a missed
direction here, so tests must cover a full create→duplicate→read round-trip preserving `collection_options`.

**Critically, there is a SECOND independent panel-kind enum** (skeptic design-gate finding): `domain/model.scala`'s
`sealed trait PanelType` with hand-written `fromString`/`asString` gates `POST`/`PATCH /api/panels` via
`PanelServiceHelpers.validatePanelType` BEFORE `PanelConfigCodec` is reached. Required arms: `case object Collection`
+ `fromString`/`asString` in `model.scala`; a `CollectionCreate` arm in `PanelServiceHelpers.buildNewPanel`'s
`CreateConfig` match (sealed — non-exhaustive otherwise); `PanelType.fromString` acceptance in
`DashboardServiceValidation.validatePanelEntries` (dashboard import path); and `"collection"` added to
`DashboardProposalService.DataPanelKinds` so agent-proposed collections get the binding-required validation the bound
trio gets. `PanelTypeSpec.scala` covers the round-trip.

## Risks / Trade-offs

- [Large multi-row types render many tiles] → v1 renders the first fetched page only; body scrolls on desktop;
  documented as the pagination non-goal.
- [Missed mapper direction silently drops config on duplicate] → explicit round-trip test (D8); evaluator re-checks.
- [spray-json omits `Option=None`] → decode/tests exercise `collection_options` fields ABSENT, not just null.
- [Export/import + public dashboard paths flow through the same codec] → covered by codec tests; smoke-check export
  round-trip in evaluation.
- [Mobile intrinsic height could make a 50-row collection a very tall card] → acceptable for v1 (matches markdown
  behavior); page-size cap bounds it; revisit after device testing.

## Migration Plan

Additive only: `V57` adds one nullable JSONB column; existing rows unaffected (NULL = no collection). Rollback = drop
column. No data migration, no API version bump.

## Open Questions

None blocking — self-approved decisions recorded below.

## Planner Notes (self-approved)

- Grid item minimum width ~140px (metric tile legibility floor), clamped so 390px content width yields 2 columns.
- No `DemoData` seed for collections; verification binds an existing multi-row demo DataType via the UI.
- `PANEL_SLOTS` gains a `collection: []` entry (TS exhaustiveness); the editor derives item slots from
  `PANEL_SLOTS[baseType]` instead (D2).
- `panelTemplates.ts`: no entry required — `TemplateSelectStep` always offers "Start blank" (`PANEL_TEMPLATES` is a
  `Partial<Record<...>>`); add curated templates only if trivially available.
