# Design — table-panel-config-controls (HEL-255)

## Context

`DataGrid` (`frontend/src/shared/ui/DataGrid.tsx`) already accepts `density` ("condensed" |
"normal" | "spacious", full-variant default "normal"), an explicit ordered `columns` prop, and
`columnWidths`/`onColumnResize` (HEL-251/252/253). `TablePanelConfig` persists only `dataTypeId`,
`fieldMapping`, `columnWidths` — the latter via the HEL-253 pattern: TS type → `panel.schema.json`
`TableConfig` def → `TablePanel.scala` decode/Patch → `PanelRowMapper` → dedicated `column_widths`
JSONB column (V53). Table rendering derives columns from `Object.keys(rows[0])`; the table
`columns` entry in `PANEL_SLOTS` is vestigial (rendering never reads it; the creation flow spec
says "Table panel shows no additional fields"). Scope was escalated and resolved: minimal storage
extension (`density` + `columnOrder`) following HEL-253 exactly — nothing broader.

## Goals / Non-Goals

**Goals:** persisted per-panel `density` + `columnOrder`; Table edit-pane controls (density
dropdown, column visibility + up/down order, reset widths) in the Epic A config language; config
applied everywhere `TableRenderer` renders (including mobile stack); mobile ≥44px touch targets.

**Non-Goals:** other panel kinds; generalized display-config abstraction; `DataGrid` changes;
drag-and-drop reordering; per-column formatters / sort defaults.

## Decisions

**D1 — Storage: two nullable columns on `panels`, one migration (V55).**
`table_density TEXT NULL` and `column_order JSONB NULL` (JSON array of strings), mirroring V53's
"dedicated column per display concern" convention (its comment explicitly rejects folding display
state into `field_mapping`). Absent/NULL = defaults, so existing rows migrate with zero data
migration. Alternative (single JSONB "displayConfig" blob) rejected: breaks the established
one-concern-per-column pattern and invites unbounded growth.

**D2 — `columnOrder` semantics: authoritative visible-set when non-empty.**
`columnOrder: string[]` = ordered list of VISIBLE column keys. Absent/empty → all columns visible
in natural (row-key / DataType) order. Non-empty → exactly those keys render, in that order;
`TableRenderer` intersects the stored list with the keys actually present in the data (stale keys
from a rebound/changed DataType are silently skipped, never rendered as empty columns). Trade-off
accepted (see Risks): fields added to the DataType later stay hidden until the user re-edits.
Alternative (separate `hiddenColumns` + order list) rejected as two-fields-one-concern per the
escalation resolution.

**D3 — Wire shape: extend `TablePanelConfig` + `Patch` in `TablePanel.scala` verbatim-style.**
Add `density: Option[String]` and `columnOrder: Option[List[String]]` to the case class; extend
`decode` and `Patch.decode` with the same `None`/`JsNull`/typed-value triage as `columnWidths`.
`applyPatch` folds identically. **Invalid density values follow the `imageFit`/`orientation`
precedent exactly** (`ImagePanel.scala` Patch + `RequestValidation.validateImageFit`): a new
`RequestValidation.validateTableDensity` allow-list is checked in `Patch.decode` and rejects
unknown values via `deserializationError` → 400. The lenient create/read `decode` path treats a
wrong-typed or unknown value as absent (never stored as-is), matching `decode`'s existing
philosophy. **spray-json omits `Option=None` on the wire** — tests MUST cover payloads with the
fields ABSENT (not just null), and `PanelRowMapper`'s table arm (`domainToRow` +
`tableConfig(row)`) gets explicit round-trip coverage — the HEL-245 markdown-arm bug (dropped
`type_id`/`field_mapping`) is the sibling failure mode. `PanelRepository.PanelRow`, the Slick
table projection, **and the `configColumnsOf`/`configColumnValuesOf` tuple pair in
`PanelRepository.scala`** (the HEL-296 single source of truth that both `PanelRepository.replace`
and `PanelMutationRepository.batchUpdate` write through — 12 → 14 elements) gain the two columns;
missing the tuple pair would make the new fields silently never persist, so persistence MUST be
tested through the repository/endpoint write path, not only via in-memory `PanelRowMapper`
round-trips.

**D4 — Schema: extend `TableConfig` in `schemas/panel.schema.json`.**
`density`: `enum: ["condensed","normal","spacious"]`; `columnOrder`: `array` of `string`. Both
optional; `additionalProperties: false` retained.

**D5 — Editor: new `TableDisplayFields` component in `features/panels/ui/editors/`, rendered by
`BindingEditor` for table panels.** It joins the existing `PanelEditorHandle` save/reset/dirty
flow (state hoisted or exposed the same way `MetricValueEditor`/`ChartAggregationFields` are —
presentational child, state in `BindingEditor`). Controls, styled with existing
`panel-detail-modal__*` patterns + shared `Select`:
- Density: shared `Select`, options Condensed/Normal/Spacious; initial `config.density ?? "normal"`.
- Columns: one row per bound DataType field (via `fieldOptions(selectedType)`) — visibility
  checkbox + up/down buttons; derived from `config.columnOrder` (absent → all visible, natural
  order). Unbound panel → section hidden (no DataType, no columns to configure).
- Reset column widths: button issuing `columnWidths: null` through the save PATCH; disabled when
  no stored widths.
Save extends the existing table PATCH path (`updatePanelBinding` thunk or a sibling
`updateTableDisplay` thunk in `panelsSlice` — executor's call, but the fulfilled reducer MUST
update the stored panel so re-opening the modal reflects reality). Persist `density` only when it
differs from the default-or-stored value (avoid writing "normal" onto every untouched panel).
Remove the vestigial `table` entry from `PANEL_SLOTS` (→ `[]`); `BindingEditor` renders
`TableDisplayFields` instead. No spec depends on the old slot.

**D6 — Renderer: `TableRenderer` maps config → `DataGrid` props.**
New props `density` and `columnOrder` (passed from panel config by `PanelContent`); builds the
`columns: ColumnDef[]` prop per D2 for both the pagination and rawRows paths. Reset-widths and
external width clears must be visible without reload: widen the existing "adjust state when a
prop changes" seed so it also re-seeds when the persisted `columnWidths` transitions to
empty/absent for the same panel (or key on a config revision) — executor verifies with a test.
Mobile stack renders through the same `TableRenderer`, so config applies there for free — but it
is a first-class verification target, not assumed.

**D7 — Mobile touch targets: extend the HEL-245 pattern.**
New controls added to the `@media (max-width: 768px)` block in `PanelDetailModal.css` (≥44px) and
asserted in the existing CSS-lock test `PanelDetailModal.css.test.ts` — extend, don't reinvent.

## Risks / Trade-offs

- [New DataType fields stay hidden once `columnOrder` is set] → documented in spec; editor always
  lists ALL current DataType fields (unchecked when absent from the list), so one visit fixes it.
- [PanelRowMapper arm drift (HEL-245 sibling bug)] → explicit domain→row→domain round-trip test
  for a table panel with density+columnOrder+widths set AND one with all three absent.
- [`fieldMapping`-shaped confusion: `columnOrder` keys are data column keys, not slots] → naming
  + spec language make this explicit; keys come from the bound DataType's fields.
- [Stale `columnOrder` after rebinding to a different DataType] → renderer intersection (D2)
  prevents ghost columns; editor shows only current fields.
- [Writing `density:"normal"` explicitly vs absent ambiguity] → both render identically by
  definition; spec pins "absent OR normal → normal".

## Migration Plan

Flyway V55 `ALTER TABLE panels ADD COLUMN table_density TEXT; ADD COLUMN column_order JSONB;`
(nullable, no backfill). Rollback = drop columns; absent fields already mean defaults everywhere.

## Planner Notes (self-approved)

- Reset-widths implemented as part of the modal save flow (single PATCH), not an immediate
  side-effect button — matches the edit-pane's save/cancel contract (HEL-243 language).
- Density persisted in `config`, not `appearance` — appearance is cross-kind visual chrome;
  density is table display config alongside `columnWidths` (V53 precedent).
- Vestigial slot removal approved as in-scope (creation flow unaffected per
  `panel-creation-type-config` spec; only `BindingEditor`/`FieldMappingSlots` consume it).
