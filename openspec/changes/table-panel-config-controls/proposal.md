# Proposal — table-panel-config-controls (HEL-255)

## Why

The DataGrid primitive already supports density, explicit column sets, and drag-resized widths
(HEL-251/252/253), but a Table panel exposes none of it in its config editor: density and column
visibility/order aren't persisted per panel at all, and the only table-specific control is a
vestigial `columns` fieldMapping slot that rendering never reads. HEL-255 closes that gap.

## What Changes

- Add optional `density` (`condensed | normal | spacious`) and `columnOrder` (ordered
  visible-column key list) to `TablePanelConfig`, following the HEL-253 `columnWidths` pattern
  end-to-end: TS type, `schemas/panel.schema.json`, `TablePanel.scala` parse/patch,
  `PanelRowMapper`, one Flyway `ALTER TABLE panels ADD COLUMN` migration. Absent = defaults
  (density normal; all columns visible in row/DataType order) — zero data migration.
- Table rendering (`TableRenderer`) maps the persisted config onto `DataGrid` props (`density`,
  `columns`), including in the read-only mobile panel stack.
- Redesign the Table panel's edit pane in the panel detail modal: density dropdown, column
  visibility + up/down reorder controls, and a reset-column-widths action (clears stored
  `columnWidths` via the existing PATCH path). Config language follows the Epic A pattern
  (HEL-243/244/245); mobile ≥44px touch targets extend the HEL-245 `PanelDetailModal.css`
  media-block + CSS-lock-test pattern.
- Remove the vestigial table `columns` entry from `PANEL_SLOTS` (superseded by the new controls;
  no spec or creation flow depends on it).

## Capabilities

### New Capabilities

- `table-panel-display-config`: persisted per-panel `density` + `columnOrder` on
  `TablePanelConfig` — storage shape, absent-field defaults/migration semantics, wire tolerance
  (spray-json omits `Option=None`), and rendering through `DataGrid` props.
- `table-panel-config-editor`: the Table panel edit-pane controls (density dropdown, column
  visibility/order list, reset widths), their persistence semantics, and mobile touch-target
  requirements.

### Modified Capabilities

(none — `data-grid` and `table-panel-column-widths` requirements are consumed unchanged)

## Non-goals

- Per-column formatters, sort defaults (explicitly future per ticket).
- Density/column config for any other panel kind, or a generalized display-config abstraction.
- Changes to `DataGrid` itself (props already exist).
- Drag-and-drop reordering (simple up/down controls satisfy the ticket).

## Impact

- Frontend: `panel.ts` types, `TableRenderer.tsx`, `BindingEditor.tsx` (+ new table config
  section component), `panelSlots.ts`, `panelService`/`panelsSlice` PATCH plumbing,
  `PanelDetailModal.css` (+ CSS-lock test).
- Backend: `TablePanel.scala`, `PanelRowMapper.scala`, new Flyway migration (V55+).
- Contract: `schemas/panel.schema.json` `TableConfig` def.
