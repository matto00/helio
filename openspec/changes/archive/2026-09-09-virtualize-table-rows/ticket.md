# HEL-458: Virtualized row rendering for large table panels

## Description

`DataGrid` (`frontend/src/shared/ui/DataGrid.tsx`) renders every row as a `<tr>` in the DOM. Table panels grow via the "Load more" affordance in `TableRenderer` (`frontend/src/features/panels/ui/renderers/TableRenderer.tsx`), which appends client-sliced pages (`panelThunks.ts` `fetchPanelPage`). With large row counts (thousands) the accumulated DOM makes scrolling and re-render janky. The full row set is already in memory client-side, so the fix is DOM windowing, not a new fetch strategy.

## Scope

* Add row virtualization/windowing to the `full`-variant `DataGrid` so only rows near the viewport are mounted, with correct scroll height. Keep a hand-rolled or lightweight approach consistent with the repo's dependency posture; if a library is introduced, justify it per CONTRIBUTING.md and keep it tree-shakeable (coordinate with the bundle-size audit ticket HEL-353).
* Preserve existing behavior: density row heights, column widths, resize handles, sort/filter, and column pinning must all continue to work under virtualization. Virtualization must read the density-derived row height rather than assuming a fixed constant.
* Keep `table-layout: fixed` column-width semantics intact (see the `DEFAULT_COLUMN_WIDTH` note in `DataGrid.tsx`) — windowing must not collapse column widths.
* Provide a graceful path for small tables (below a threshold): render normally to avoid overhead.
* Maintain accessibility: virtualized rows must not break keyboard scroll, focus, or screen-reader row semantics (DESIGN.md §8).

## Acceptance criteria

* AC1: A table panel with several thousand rows scrolls smoothly with a stable DOM node count (windowed), verified in the app.
* AC2: Density, column widths, resize, sort, filter, and column pinning (HEL-465, merged `dae1117e`, sticky leading-run columns with cumulative width-aware offsets) all still function under virtualization.
* AC3: Small tables render unchanged (no windowing overhead).
* AC4: No horizontal-scroll or column-collapse regression.
* AC5: Jest/RTL coverage for the windowing math and the small-table bypass; keyboard scroll, focus (header-row controls: resize handle, pin toggle, filter inputs — all in `<thead>`, untouched by `<tbody>` windowing), and screen-reader row semantics (`aria-rowcount`/`aria-rowindex`, spacer rows excluded from the a11y tree) must not regress.

## Out of scope

* Server-side pagination of the rows endpoint (rows remain fully client-loaded; that is a separate backend concern).
* Virtualizing non-table panel types.
* Panel-grid (dashboard-level) virtualization — tracked under HEL-353.
* HEL-1065's two pre-existing CSS-only pin-toggle defects (header-label/icon overlap on truncating columns; sub-44px tap target with split focus ring at ≤430px/coarse-pointer) — not this ticket's to fix; cite HEL-1065 if surfaced.

## Dependencies

* Coordinate with HEL-353 bundle-size/code-splitting audit if a windowing library is added. Composes with in-panel sort/filter/pinning (same epic, parent HEL-351). Binding: DESIGN.md, CONTRIBUTING.md.

## Recent DataGrid.tsx history to read before planning (AC2)

* HEL-448 (#595) column sort
* HEL-451 (#608) column filtering
* HEL-469 (#609) per-column cell formatting
* HEL-465 (`dae1117e`, #619) column pinning — `position: sticky`, per-column-width-aware cumulative offsets, pin constrained to leading contiguous run of current column order
* HEL-520 (`7a14601f`, #617) — **checked directly (`git show --stat 7a14601f`) and found NOT to touch `DataGrid.tsx` at all**; its changes are `e2e/focus-presence-guard.spec.ts`, `e2e/hel520-focus-presence-guard.regression.spec.ts`, `e2e/support/focusPresenceProbe.ts`, `PipelineDetailHeader.css`, `Modal.test.tsx`, `tokenAuditSweep.css.test.ts` — none of which reference DataGrid/data-grid/table. There is no "HEL-520 rendered focus-presence guard" in this surface to preserve; do not cite it as a constraint on this ticket (design-gate skeptic round 1 finding).
