## Files modified

- `frontend/src/features/panels/ui/PanelGrid.css` — removed `overflow: hidden` from
  `.panel-grid-card`; the card now relies on `.panel-content--table` (own `overflow-y: auto`) and
  `DataGrid`'s own bidirectional scroll container instead of hard-clipping. Verified other panel
  types sharing this class (`.image-panel`, `.panel-content--text`) already manage their own
  overflow independently, so removing the card-level clip is safe for all panel types.
- `frontend/src/features/panels/ui/PanelDetailModal.css` — removed `overflow: hidden` from
  `.panel-detail-modal__view-body`, same rationale (wraps the same `PanelContent` tree used on the
  dashboard grid).
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` — wrapped the inferred-schema `<table
  className="source-detail-panel__schema-table">` in a new
  `<div className="source-detail-panel__schema-table-wrapper">`.
- `frontend/src/features/sources/ui/SourceDetailPanel.css` — added
  `.source-detail-panel__schema-table-wrapper` (border + `border-radius` + `overflow: auto`,
  moved off the `<table>`); removed `border`, `border-radius`, and `overflow: hidden` from
  `.source-detail-panel__schema-table` itself (this is a raw `<table>`, not a `DataGrid` instance —
  the one real "overflow: hidden adjacent to a `<table>`" hit named in the ticket).
- `openspec/changes/datagrid-scroll-overflow-fix/specs/data-grid/spec.md` — formalized the
  `DataGrid` scroll contract as an ADDED requirement (already-implemented HEL-251 behavior; no
  `DataGrid.tsx`/`.css` code changes were needed — confirmed by reading `DataGrid.css`, which
  already sets `overflow: auto` on `.ui-data-grid` and `position: sticky` on `thead th`).
- `openspec/changes/datagrid-scroll-overflow-fix/tasks.md` — checked off all 8 tasks.

## Root cause / probe evidence (per systematic-debugging law)

- **Root cause:** three ancestor/adjacent CSS rules set `overflow: hidden` on containers wrapping
  either the `DataGrid` primitive or a raw `<table>`, clipping content that the primitive itself
  already scrolls correctly (fixed in HEL-251) — the ancestors just hadn't caught up.
- **Probe (dev-server, Playwright, real 30-column/200-row dataset):** created a CSV data source
  (`HEL-254 Wide Table Source`, 30 columns × 200 rows) → pipeline (`HEL-254 Wide Table Pipeline`,
  `Select fields` step, all 30 fields, ran successfully, 200 rows written) → dashboard
  (`HEL-254 Scroll Verification`) → Table panel (`Full Data Grid` template) bound to
  `HEL254WideType`.
- **Probe output (dashboard grid card, post-fix):**
  ```
  cardOverflow: "visible"        (was "hidden" pre-fix)
  gridScrollWidth: 2190, gridClientWidth: 384   → horizontal overflow present and scrollable
  gridScrollHeight: 7034, gridClientHeight: 190 → vertical overflow present and scrollable
  rowCount: 200, colCount: 30                    → full dataset in DOM, nothing clipped
  ```
  Programmatically scrolling the grid (`scrollLeft = 400`, `scrollTop = 200`) and re-screenshotting
  confirmed the header row (`col_14`…`col_18`) stayed pinned at the top of the grid's own scroll
  box while showing the columns/rows matching the new scroll position — no content cut off.
- **Probe output (panel detail modal view mode):**
  ```
  bodyOverflow: "visible"        (was "hidden" pre-fix, on .panel-detail-modal__view-body)
  gridScrollWidth: 2010, gridClientWidth: 1174  → horizontal overflow present and scrollable
  gridScrollHeight: 1784, gridClientHeight: 713 → vertical overflow present and scrollable
  ```
  Same scroll-and-screenshot check confirmed sticky header behavior in the modal's larger
  (1200×900) view.
- **Probe output (`SourceDetailPanel` schema table, 30-row spot check):**
  ```
  wrapOverflow: "auto", wrapBorderRadius: "6px", wrapBorder: "1px solid ..."
  tableOverflow: "visible", rowCount: 30
  ```
  Rounded corners preserved (moved to the wrapper), table itself no longer clips.
