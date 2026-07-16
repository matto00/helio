## 1. Backend — storage + wire shape

- [x] 1.1 Add Flyway V55 migration: `ALTER TABLE panels ADD COLUMN table_density TEXT` + `ADD COLUMN column_order JSONB` (nullable, no backfill; comment per V53 convention)
- [x] 1.2 Extend `TablePanelConfig` in `TablePanel.scala`: `density: Option[String]`, `columnOrder: Option[List[String]]`; extend `decode` (lenient: invalid density → absent) and `Empty`
- [x] 1.3 Extend `TablePanelConfig.Patch` + `Patch.decode` with `None`/`JsNull`/typed triage for both fields (mirror `columnWidths`); extend `applyPatch`; add `RequestValidation.validateTableDensity` allow-list checked in `Patch.decode` (invalid → `deserializationError` → 400, `imageFit` precedent)
- [x] 1.4 Add `tableDensity`/`columnOrder` to `PanelRepository.PanelRow` + Slick projection AND extend the `configColumnsOf`/`configColumnValuesOf` tuple pair (12 → 14, HEL-296 single source of truth); wire `PanelRowMapper` table arm both directions (`domainToRow` + `tableConfig(row)`)
- [x] 1.5 Extend `TableConfig` def in `schemas/panel.schema.json`: `density` enum + `columnOrder` string array (keep `additionalProperties: false`)

## 2. Frontend — types + renderer

- [x] 2.1 Extend `TablePanelConfig` in `frontend/src/features/panels/types/panel.ts`: `density?: TableDensity`, `columnOrder?: string[]`; export the density union
- [x] 2.2 `TableRenderer`: accept `density` + `columnOrder` props; build `ColumnDef[]` per design D2 (intersect stored order with data keys; absent/empty → all keys natural order) for both pagination and rawRows paths; pass `density` to `DataGrid`
- [x] 2.3 Pass `config.density`/`config.columnOrder` from the table panel to `TableRenderer` at its call site(s), covering desktop grid and mobile stack render paths
- [x] 2.4 Fix reset-widths visibility: re-seed `TableRenderer` local width state when persisted `columnWidths` clears for the same panel (design D6)

## 3. Frontend — edit-pane controls + persistence

- [x] 3.1 Add PATCH plumbing: service function + `panelsSlice` thunk for table display config (`density`, `columnOrder`, `columnWidths: null` reset) with fulfilled reducer updating the stored panel
- [x] 3.2 Create `TableDisplayFields.tsx` in `ui/editors/`: density `Select`, per-field visibility toggle + up/down reorder rows (fields from `fieldOptions(selectedType)`), reset-widths button (disabled when no stored widths); presentational, state hoisted to `BindingEditor`
- [x] 3.3 Wire into `BindingEditor` for table panels: initial state from config, dirty tracking, save (single PATCH, display-only save must not alter `dataTypeId`/`fieldMapping`), reset on cancel; hide Columns control when unbound
- [x] 3.4 Remove vestigial `table` entry from `PANEL_SLOTS` (→ `[]`)
- [x] 3.5 Style controls per DESIGN.md tokens/spacing using `panel-detail-modal__*` patterns; clean trivial style debt in touched CSS only
- [x] 3.6 Extend `@media (max-width: 768px)` block in `PanelDetailModal.css` so all new controls have ≥44px hit areas

## 4. Tests

- [x] 4.1 Backend: `TablePanelConfig` decode/patch tests — fields ABSENT (spray-json None-omission), null (clears), valid values, invalid density on PATCH → 400, invalid density on lenient decode → absent
- [x] 4.2 Backend: PanelRowMapper table-arm round-trip — domain→row→domain with density+columnOrder+widths set AND all three absent (HEL-245 sibling-bug guard)
- [x] 4.3 Backend: repository/endpoint persistence test — PATCH sets density+columnOrder, re-read through the repository returns them (catches a missed `configColumnsOf`/`configColumnValuesOf` extension); display-only patch leaves `dataTypeId`/`fieldMapping` untouched; migration leaves existing rows NULL/defaults
- [x] 4.4 Frontend: `TableRenderer` tests — density prop pass-through; columnOrder ordering/hiding/stale-key skip; absent → all columns; width re-seed on external clear
- [x] 4.5 Frontend: `TableDisplayFields`/`BindingEditor` tests — initial state from config, dirty/save PATCH shape, cancel revert, unbound hides Columns control, reset-widths disabled state
- [x] 4.6 Frontend: extend `PanelDetailModal.css.test.ts` CSS-lock for the new controls' mobile 44px rules
- [x] 4.7 Run gates: backend `sbt test`, frontend `npm test`, `npm run lint`, `npm run format:check`
