## Why

Table panels currently render columns at fixed/derived widths with no way for a user to adjust
them. HEL-240's grid-standardization chain (HEL-254 scroll, HEL-252 density) already hardened the
shared `DataGrid` primitive; this is the third and final Phase 2 ticket, adding user-resizable
column widths that persist across reloads for Table panels specifically.

## What Changes

- Add a drag-to-resize interaction to `DataGrid` (`variant="full"` only): a drag handle on the
  right edge of each column header, minimum width enforced (60px), independent per-column resize
  (no redistribution). `variant="preview"` instances remain read-only — no resize affordance.
- Add persisted column-width storage for Table panels: a new `columnWidths` field on
  `TablePanelConfig` (backend codec/patch/decode, following the existing `fieldMapping` pattern),
  plus the `schemas/panel.schema.json` `TableConfig` definition.
- Frontend wiring: extend `TableRendererProps` with `panelId` + `columnWidths` (today it receives
  neither) and update `PanelContent.tsx`'s call site to pass them through. `TableRenderer` loads
  persisted widths into `DataGrid` on mount, and debounced width changes save via the existing
  direct panel-config PATCH path (the same immediate-PATCH mechanism `updatePanelBinding`/
  `updatePanelContent`/etc. already use, not the 30s `PanelGrid` layout-autosave pipeline), using a
  local ref+setTimeout debounce matching the one already used in `ComputedFieldForm.tsx`.
- Resize drag handles stop event propagation so they don't fight React Grid Layout's own
  drag/resize handles on the panel card (`noCompactor` grid).

## Capabilities

### New Capabilities

- `table-panel-column-widths`: persisted per-column width storage on Table panels — backend
  config field/codec/patch/schema, and frontend load-on-mount + debounced-save wiring.

### Modified Capabilities

- `data-grid`: add a column-resize requirement (drag handle, min-width, independent resize,
  full-variant-only) to the existing primitive contract.

## Non-goals

- No Table panel config UI (dropdown/reset control) for widths — that is HEL-255 ("Table config
  rework"), which layers config-UI controls over the storage this change provides.
- No resize support on preview-variant `DataGrid` consumers (StepCard, SqlTab,
  PipelinePreviewModal, TypeDetailPanel, SourceDetailPanel) — read-only context per the ticket DoD.
- No automatic column-width redistribution when one column is resized.

## Impact

- `frontend/src/shared/ui/DataGrid.tsx` / `.css` (resize interaction, new prop(s))
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` (new `panelId`/`columnWidths`
  props, load/save wiring)
- `frontend/src/features/panels/ui/PanelContent.tsx` (`<TableRenderer>` call site passes
  `panel.id` + `panel.config.columnWidths` through)
- `frontend/src/features/panels/services/panelService.ts`, `state/panelPayloads.ts` (patch builder)
- `backend/src/main/scala/com/helio/domain/panels/TablePanel.scala` (config field/codec/patch)
- `schemas/panel.schema.json` (`TableConfig`)
- HEL-255 scope note recorded in design.md and posted to Linear (traceability)
