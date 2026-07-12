## 1. ### Backend

- [x] 1.1 Add `columnWidths: Map[String, Int]` to `TablePanelConfig` in `TablePanel.scala`
      (`Empty` defaults to `Map.empty`), following the exact `fieldMapping` decode pattern.
- [x] 1.2 Add `columnWidths: Option[Option[Map[String, Int]]]` to `TablePanelConfig.Patch`, decoded
      with the same absent-vs-null convention as `fieldMapping`.
- [x] 1.3 Update `TablePanel.applyPatch` to fold the `columnWidths` patch the same way
      `fieldMapping` is folded.
- [x] 1.4 Update `schemas/panel.schema.json`'s `TableConfig` def to add a `columnWidths` object
      property (string keys, integer values), keeping `additionalProperties: false`.
- [x] 1.5 Add/extend a backend test in `PanelSpec.scala` covering: create with no widths defaults
      to empty map, patch sets widths, patch with `null` clears widths, patch touching only
      `columnWidths` leaves `dataTypeId`/`fieldMapping` untouched and vice versa.

## 2. ### Frontend — DataGrid primitive

- [x] 2.1 Add `columnWidths?: Record<string, number>` and `onColumnResize?: (key: string, width:
      number) => void` props to `DataGridProps` in `DataGrid.tsx`.
- [x] 2.2 Render a resize handle (`<span className="ui-data-grid__resize-handle">`) on the right
      edge of each `<th>`, only when `variant="full"`.
- [x] 2.3 Implement the drag gesture (mousedown/pointerdown on the handle -> mousemove tracks delta
      -> mouseup commits): resize only the dragged column, clamp to a 60px minimum, call
      `onColumnResize(key, width)` live as the user drags. Stop propagation on the handle's
      mousedown/pointerdown so it can never reach an ancestor drag/resize listener.
- [x] 2.4 Apply `columnWidths[col.key]` to each `<th>`'s inline width when present, falling back to
      the existing `col.width` / auto behavior otherwise.
- [x] 2.5 Style the resize handle in `DataGrid.css` per `DESIGN.md` tokens (cursor, hover/active
      affordance, sizing) — visible only in the full variant.

## 3. ### Frontend — Table panel persistence wiring

- [x] 3.1 Add `columnWidths?: Record<string, number>` to the frontend `TablePanelConfig` type and
      `emptyTableConfig()` in `frontend/src/features/panels/types/panel.ts`.
- [x] 3.2 Add `buildTableWidthsPatch(columnWidths: Record<string, number>)` to `panelPayloads.ts`,
      returning `{ columnWidths }` as its own patch object (kept separate from
      `buildBindingPatch`).
- [x] 3.3 Add `updatePanelColumnWidths(panelId, columnWidths)` to `panelService.ts`, PATCHing
      `/api/panels/:id` with `{ config: buildTableWidthsPatch(columnWidths) }`.
- [x] 3.4 Extend `TableRendererProps` in `TableRenderer.tsx` with `panelId: string` and
      `columnWidths?: Record<string, number>` (it currently receives neither), and update
      `PanelContent.tsx`'s `isTablePanel(panel)` branch to pass `panel.id` and
      `panel.config.columnWidths` through to `<TableRenderer>`.
- [x] 3.5 In `TableRenderer.tsx`, pass `columnWidths` into `DataGrid` as its `columnWidths` prop,
      and wire `onColumnResize` to update local width state immediately (responsive drag) plus a
      local `useRef<ReturnType<typeof setTimeout>>` debounce (400ms, matching the pattern in
      `frontend/src/features/pipelines/ui/ComputedFieldForm.tsx`) that calls
      `updatePanelColumnWidths(panelId, ...)` once the drag settles — a direct PATCH, not routed
      through `PanelGrid`'s 30s layout-autosave pipeline.
- [x] 3.6 Confirm (and adjust if needed) that preview-variant consumers (`StepCard`, `SqlTab`,
      `PipelinePreviewModal`, `TypeDetailPanel`, `SourceDetailPanel`) pass neither `columnWidths`
      nor `onColumnResize` — they should need no code change since `DataGrid` gates resize
      rendering on `variant="full"`, but verify none of them accidentally pass `variant="full"`.

## 4. ### Tests

- [x] 4.1 `DataGrid.test.tsx`: resize handle renders only in full variant; dragging resizes only
      the dragged column; clamps at 60px minimum; `onColumnResize` fires with the live width;
      applied `columnWidths` overrides default width; preview variant ignores `columnWidths`/
      `onColumnResize` and renders no handle.
- [x] 4.2 `TableRenderer` test: loads `config.columnWidths` into `DataGrid` on mount; resize
      triggers a debounced `updatePanelColumnWidths` call; rapid resizes coalesce into one call.
- [x] 4.3 Add a test verifying a column-resize `mousedown` does not propagate to / trigger a
      `PanelGrid` drag-start (integration-level test on `PanelGrid.test.tsx` or a targeted
      DOM-event-propagation test alongside `DataGrid.test.tsx`).
- [x] 4.4 Backend `PanelSpec.scala` cases from task 1.5.
- [x] 4.5 Live verification (dev server) — PARTIAL, see executor report: backend persistence
      round-trip verified live against real dev servers (create table panel -> PATCH
      `columnWidths` -> fresh GET `/api/dashboards/:id/panels` reflects the persisted widths,
      proving a real DB round-trip survives a "reload"-equivalent fetch). The in-browser
      drag-gesture / propagation-non-interference check was NOT performed live (no browser
      automation tool available to this executor); that behavior is covered by jsdom-simulated
      DOM event tests in `DataGrid.test.tsx` (`stopPropagation` + drag-delta math) instead. Flag
      for evaluator/skeptic to confirm live in a real browser.

## 5. Cycle 2 — fix `table-layout: auto` silently ignoring resize (evaluation-1.md)

- [x] 5.1 Add `table-layout: fixed` to `.ui-data-grid--full .ui-data-grid__table` in
      `DataGrid.css` (scoped to `--full` only, so `--preview` keeps `auto` layout/content-based
      sizing) — required for the inline `width` set on a resized `<th>` to actually govern
      rendered column width in a real browser, per evaluation-1.md's live-browser repro.
- [x] 5.2 Seed `DEFAULT_COLUMN_WIDTH` (160px) onto every `"full"`-variant column that has
      neither been resized nor given an explicit `ColumnDef.width`, so unresized columns don't
      collapse toward ~0px once fixed layout is active (`DataGrid.tsx`).
- [x] 5.3 Re-verify live via Playwright MCP against the running dev servers
      (`localhost:5426`/`localhost:8333`, migration V53 confirmed applied): dragging a handle
      visibly resizes only that column (rendered `getBoundingClientRect().width`, not just the
      inline `style` attribute), sibling columns are visually unchanged, and a resized width
      visibly persists after a real full-page navigate/reload. RGL non-interference re-confirmed
      (`react-grid-item` box/class unchanged across the drag). 0 console errors.
- [x] 5.4 Add a static-source regression guard (`DataGrid.test.tsx`) asserting
      `table-layout: fixed` is present and scoped correctly, plus a render-level assertion that
      every full-variant `<th>` gets an explicit width — documented as a stand-in for a
      real-browser layout check, since jsdom has no CSS layout engine by construction (see the
      code comments on `DEFAULT_COLUMN_WIDTH`/`.ui-data-grid--full .ui-data-grid__table` for the
      "why", so a future refactor doesn't silently drop either).
- [x] 5.5 (Non-blocking suggestion, addressed) Keyboard operability: the resize handle is now
      `tabIndex={0}` with an `ArrowLeft`/`ArrowRight` nudge handler (`KEYBOARD_RESIZE_STEP` =
      10px, same `MIN_COLUMN_WIDTH` floor as the drag gesture), plus a `:focus-visible` ring
      matching DESIGN.md §8. Verified live (keyboard focus + nudge visibly resized a column
      without affecting siblings or triggering RGL).
- [ ] 5.6 (Non-blocking suggestion, not addressed) `liveWidths`'s lack of a reset-on-`panelId`-
      change guard remains unaddressed — left as-is per evaluation-1.md's own assessment that
      it's not currently reachable (`DataGrid` is always remounted per panel today).
