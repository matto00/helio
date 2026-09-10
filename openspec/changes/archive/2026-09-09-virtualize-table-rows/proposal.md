## Why

`DataGrid`'s `full` variant mounts one `<tr>` per row with no windowing. Table panels
accumulate rows client-side via "Load more" (`TableRenderer.tsx` / `fetchPanelPage`), and at
several thousand rows the fully-mounted DOM makes scrolling and re-render janky. The full row
set is already resident in memory, so the fix is DOM windowing, not a new fetch strategy.

## What Changes

- Add row virtualization to `DataGrid`'s `full` variant: only rows near the viewport are
  mounted, with a spacer/offset mechanism preserving correct total scroll height.
- Read row height from the density-derived value already computed for each `DataGridDensity`,
  never a hardcoded constant.
- Preserve `table-layout: fixed` column-width semantics; windowing must not collapse widths.
- Preserve density, column widths/resize, sort, filter, and column pinning (`position: sticky`
  leading-run offsets, HEL-465) under windowing.
- Below a row-count threshold, bypass virtualization and render every row normally.
- Preserve keyboard scroll, focus (header-row resize handle/pin toggle/filter inputs; no existing
  guard on this surface — see design.md), and screen-reader row semantics (DESIGN.md §8, new
  `aria-rowcount`/`aria-rowindex` behavior).
- Hand-rolled windowing (own hook/component), consistent with the repo's dependency posture — see
  `design.md` for the library-vs-hand-rolled decision record.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `data-grid`: adds windowed/virtualized row rendering to the `full` variant, with a small-table
  bypass threshold, while preserving all existing per-row behaviors (density, resize, sort,
  filter, pinning, focus/keyboard semantics).

## Impact

- `frontend/src/shared/ui/DataGrid.tsx` (primary), `DataGrid.css` (row/spacer geometry).
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — no architecture change expected
  (rows remain fully client-loaded); verify no assumption about full DOM row count.
- Test coverage: `DataGrid.test.tsx` (windowing math, small-table bypass) plus a live/manual
  verification pass for AC1/AC4 (jsdom cannot render real scroll geometry).
- No backend, schema, or persistence changes. No new runtime dependency unless justified in
  `design.md` per CONTRIBUTING.md, coordinated with HEL-353 if one is added.
