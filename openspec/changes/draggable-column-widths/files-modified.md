# Files modified — HEL-253 draggable column widths

## Backend

- `backend/src/main/scala/com/helio/domain/panels/TablePanel.scala` — added
  `columnWidths: Map[String, Int] = Map.empty` to `TablePanelConfig`, matching
  `decode`/`Patch`/`applyPatch` handling for the exact `fieldMapping`
  absent-vs-null convention.
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` —
  added a `column_widths` JSONB column to `PanelTable`/`PanelRow` and threaded
  it through `configColumnsOf`/`configColumnValuesOf` (the shared tuple both
  `replace` and `batchUpdate`'s config-patch branch write back). **Not called
  out in tasks.md/design.md** — needed so a resize actually survives a real
  page reload (DB round-trip), not just an in-process domain round-trip; see
  report for rationale.
- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala` —
  read/write `columnWidths` to/from the new `column_widths` column
  (`tableConfig`/`domainToRow`), plus `columnWidthsColumn`/`parseColumnWidths`
  helpers mirroring the existing `jsObjectColumn`/`parseJsObject` pattern.
- `backend/src/main/resources/db/migration/V53__panel_column_widths.sql` —
  new nullable `column_widths JSONB` column on `panels`, following the
  `V43__panel_aggregation_column.sql` precedent exactly. **Not called out in
  tasks.md/design.md** — same rationale as above.
- `backend/src/test/scala/com/helio/domain/PanelSpec.scala` — new
  `TablePanelConfig.columnWidths` test block (default-empty, decode,
  round-trip, `Patch.decode` absent/null/present, `applyPatch`
  absent/null/present, and cross-field isolation from
  `dataTypeId`/`fieldMapping` in both directions); plus a 2-arg ->
  3-arg fixup on two pre-existing `TablePanelConfig(...)` call sites.

## Schema

- `schemas/panel.schema.json` — added `columnWidths` (object, integer values,
  `additionalProperties: false`) to the `TableConfig` def.

## Frontend — DataGrid primitive

- `frontend/src/shared/ui/DataGrid.tsx` — added `columnWidths`/`onColumnResize`
  props; renders a `.ui-data-grid__resize-handle` per column header only when
  `variant="full"`; implements the mousedown -> mousemove -> mouseup drag
  gesture (60px clamp, per-column-only resize, live `onColumnResize` callback,
  `stopPropagation`/`preventDefault` on the handle's mousedown, a matching
  no-op `stopPropagation` on pointerdown as defense-in-depth). **Cycle 2
  (evaluation-1.md):** added `DEFAULT_COLUMN_WIDTH` (160px), applied as a
  fallback so every full-variant column gets an explicit width even when
  unresized (required once `table-layout: fixed` is active — see
  `DataGrid.css`); added `KEYBOARD_RESIZE_STEP` + `handleResizeKeyDown`
  (`ArrowLeft`/`ArrowRight` nudge, `tabIndex={0}` on the handle) addressing the
  non-blocking keyboard-operability suggestion.
- `frontend/src/shared/ui/DataGrid.css` — resize-handle styling (cursor,
  hover/active affordance) using `--space-2`/`--app-border-strong`/
  `--app-transition` tokens per DESIGN.md. **Cycle 2:** added
  `table-layout: fixed` scoped to `.ui-data-grid--full .ui-data-grid__table`
  only (this is the actual fix for evaluation-1.md's blocking finding — see
  the in-file comment for why it's scoped and why it must not be dropped);
  added a `:focus-visible` ring on the resize handle for the new keyboard path.
- `frontend/src/shared/ui/DataGrid.test.tsx` — new resize-handle test suites:
  full-vs-preview rendering, `columnWidths` override, drag-resizes-only-that-
  column + live `onColumnResize`, 60px clamp, and a DOM-event-propagation test
  proving the handle's mousedown never reaches an ancestor listener (stands in
  for the "does not trigger PanelGrid drag" integration scenario per design.md's
  suggested alternative). **Cycle 2:** new keyboard-nudge test suite
  (focusable, ArrowRight/ArrowLeft resize + 60px clamp, ignores other keys);
  new static-source regression-guard suite asserting `table-layout: fixed` is
  present/correctly scoped in `DataGrid.css` and that every full-variant `<th>`
  renders with an explicit width — a documented stand-in for a real-browser
  layout check (jsdom has no CSS layout engine), per evaluation-1.md change
  request 4.

## Frontend — Table panel persistence wiring

- `frontend/src/features/panels/types/panel.ts` — `TablePanelConfig.columnWidths?`
  + `emptyTableConfig()` seeds `columnWidths: {}`.
- `frontend/src/features/panels/state/panelPayloads.ts` — new
  `buildTableWidthsPatch`, kept separate from `buildBindingPatch`.
- `frontend/src/features/panels/services/panelService.ts` — new
  `updatePanelColumnWidths(panelId, columnWidths)`, a direct
  `PATCH /api/panels/:id`.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — extended
  `TableRendererProps` with `panelId`/`columnWidths`; local width state seeded
  from the persisted config (reloaded when `panelId` changes, computed
  during render per React's "adjusting state when a prop changes" guidance
  rather than an effect); `onColumnResize` updates local state immediately and
  debounces a `updatePanelColumnWidths` PATCH 400ms after the last resize tick
  (ref+setTimeout, matching `ComputedFieldForm.tsx`).
- `frontend/src/features/panels/ui/renderers/TableRenderer.test.tsx` — new:
  loads `columnWidths` on mount, debounces a resize into one persisted call,
  coalesces rapid resizes into one call. **Cycle 2:** updated the "no
  `columnWidths`" case — it now asserts the column falls back to `DataGrid`'s
  seeded `160px` default instead of asserting no `style` attribute at all
  (the old assertion is precisely what the cycle-1 bug would have kept
  passing).
- `frontend/src/features/panels/ui/PanelContent.tsx` — `isTablePanel` branch
  passes `panel.id` and `panel.config.columnWidths` to `<TableRenderer>`.
- `frontend/src/test/panelFixtures.ts` — `makeTablePanel` threads
  `columnWidths` through for test fixtures.

## Verified, not modified

- Preview-variant `DataGrid` consumers (`StepCard`, `SqlTab`,
  `PipelinePreviewModal`, `TypeDetailPanel`, `SourceDetailPanel`) all pass
  `variant="preview"` and neither `columnWidths` nor `onColumnResize` —
  confirmed via `grep`, no changes needed (task 3.6).
- `backend/src/main/scala/com/helio/app/DemoData.scala`'s
  `TablePanelConfig(DataTypeId(""), JsObject.empty)` 2-arg construction still
  compiles unchanged — `columnWidths` has a `Map.empty` default parameter.
