# Files modified — table-panel-config-controls (HEL-255)

## Backend

- `backend/src/main/resources/db/migration/V55__panel_table_display_config.sql` — new Flyway migration: nullable `table_density` TEXT + `column_order` JSONB columns (V53 one-concern-per-column precedent; NULL = defaults, zero data migration).
- `backend/src/main/scala/com/helio/domain/panels/TablePanel.scala` — added `density: Option[String]` + `columnOrder: Option[List[String]]` to `TablePanelConfig`; extended `decode` (lenient: invalid → absent), `Patch`/`Patch.decode` (validated density via allow-list → 400; None/JsNull/typed triage), and `applyPatch`; format bumped jsonFormat3 → jsonFormat5.
- `backend/src/main/scala/com/helio/api/RequestValidation.scala` — added `validateTableDensity` allow-list (`condensed`/`normal`/`spacious`), mirroring `validateImageFit`.
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — added `tableDensity`/`columnOrder` to `PanelRow`, the Slick table columns, and the `configColumnsOf`/`configColumnValuesOf` tuple pair (12 → 14, HEL-296 single source of truth); `*` projection converted to a Slick HList (23 columns exceeds the 22-tuple ceiling).
- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala` — wired the table arm both directions (`domainToRow` writes density/columnOrder; `tableConfig` reads them back) with JSON array encode/decode helpers.

## Contract

- `schemas/panel.schema.json` — extended `TableConfig` with `density` (enum) + `columnOrder` (string array), `additionalProperties: false` retained.

## Frontend

- `frontend/src/features/panels/types/panel.ts` — added `TableDensity` union and `density?`/`columnOrder?` to `TablePanelConfig`.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — accepts `density`/`columnOrder`; builds ordered/filtered `ColumnDef[]` per design D2 for both render paths; passes `density` to `DataGrid`; re-seeds local width state on a persisted-widths content change (D6 reset visibility).
- `frontend/src/features/panels/ui/PanelContent.tsx` — passes `config.density`/`config.columnOrder` to `TableRenderer` (desktop grid + mobile stack share this path).
- `frontend/src/features/panels/ui/editors/useTableDisplayState.ts` — new hook owning density/column-order/visibility/width-reset state, dirty tracking, reset, and the save-patch shape (absent-vs-null).
- `frontend/src/features/panels/ui/editors/TableDisplayFields.tsx` — new presentational Table display controls (density Select, column visibility + up/down rows, Reset column widths).
- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` — wires `useTableDisplayState`/`TableDisplayFields` for table panels into the existing dirty/save/cancel flow; folds the display config into the single Save PATCH.
- `frontend/src/features/panels/state/panelSlots.ts` — removed the vestigial `table` "columns" fieldMapping slot (→ `[]`).
- `frontend/src/features/panels/state/panelPayloads.ts` — `buildBindingPatch` extended with `density`/`columnOrder`/`columnWidths` (absent-vs-null).
- `frontend/src/features/panels/services/panelService.ts` — `updatePanelBinding` gains a trailing `tableDisplay?: TableDisplayPatch` param (new exported interface).
- `frontend/src/features/panels/state/panelThunks.ts` — `updatePanelBinding` thunk threads `tableDisplay` through to the service.
- `frontend/src/features/panels/ui/PanelDetailModal.css` — new Table display control styles (tokens only) + extended `@media (max-width: 768px)` block with ≥44px hit areas for the new controls.

## Cycle 2 — evaluator change requests

- **CR#1 (stale Reset button):** `frontend/src/features/panels/state/panelThunks.ts` adds a `updatePanelColumnWidths` thunk wrapping the existing service call; `frontend/src/features/panels/state/panelsSlice.ts` adds its `fulfilled` reducer (replaces the stored panel) + re-export; `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` now dispatches that thunk (via `useAppDispatch`) from the debounced resize handler instead of the fire-and-forget service call, so `config.columnWidths` (and the edit pane's `hasStoredWidths`/Reset button) syncs without a reload.
- **CR#2 (binary file):** `frontend/src/features/panels/ui/editors/useTableDisplayState.ts` — replaced the literal `\x00` (NUL) `fieldKeys.join(...)` re-seed-key separator with `JSON.stringify(fieldKeys)`, so the file is text (not `Bin`) in git/PR review and a NUL-containing key can't corrupt the key. Verified: `git diff main --stat` shows `174 insertions`, not `Bin`.

## Tests

- `backend/.../PanelSpec.scala` — density/columnOrder decode (absent/null/valid/invalid-lenient), Patch decode (invalid density → `DeserializationException`), applyPatch, wire None-omission.
- `backend/.../PanelRowMapperSpec.scala` — table-arm round-trip with all three display fields set AND all absent (HEL-245 sibling-bug guard).
- `backend/.../ApiRoutesSpec.scala` — endpoint persistence through a real repository re-read (catches a missed `configColumnsOf` extension), invalid density → 400 + nothing persisted, display-only PATCH leaves dataTypeId/fieldMapping intact.
- `frontend/.../TableRenderer.test.tsx` — density pass-through, columnOrder order/hide/stale-skip (raw + pagination paths), width re-seed on external clear, and (CR#1) same-session resize → stored panel `columnWidths` synced; renders now go through `renderWithStore` since TableRenderer dispatches.
- `frontend/.../PanelContent.test.tsx` — table-panel renders switched to `renderWithStore` (TableRenderer now dispatches).
- `frontend/.../editors/useTableDisplayState.test.ts` — initial-from-config, dirty/patch shape, reorder→columnOrder, width-reset pending, reset revert, unbound.
- `frontend/.../editors/TableDisplayFields.test.tsx` — density options, visibility checkboxes, move-button disabled edges, unbound hides Columns, reset-widths enabled/disabled/pending.
- `frontend/.../PanelDetailModal.css.test.ts` — extended CSS-lock for the new controls' mobile 44px rules.
- `frontend/.../PanelDetailModal.test.tsx` + `PanelDetailModal.aggregation.test.tsx` — updated the over-specified `updatePanelBinding` call assertions for the new trailing `tableDisplay` arg (undefined for metric panels; backward-compatible).

## Notes / deviations

- Design D3 specified extending the projection tuple; a literal 23-tuple is impossible in Scala (max 22), so the `panels` `*` projection was migrated to a Slick HList. Behavior-preserving; documented inline.
- Table display config is folded into the existing `updatePanelBinding` Save (one PATCH) rather than a separate thunk (design D5 left this to executor discretion); the `fulfilled` reducer already replaces the stored panel so re-opening the modal and live panels reflect saved state.
