## Why

Table panels can now be sorted (HEL-448) but not narrowed. On a wide Output, finding the rows you
care about means reading past everything else. Filtering is the second of four in-panel data-grid
capabilities (HEL-451 filtering, HEL-465 pinning, HEL-469 cell formatting) and the first to expose a
problem sort could paper over: a client-side filter over a fetched SAMPLE can return few or zero
rows for a value that occurs thousands of times upstream, and an empty table is a confident answer.
Getting that disclosure right is as much of this ticket as the filtering itself.

## What Changes

- `DataGrid` (`full` variant only) gains an optional filter row: a quick-filter input matching
  case-insensitively across visible columns, plus a per-column contains input. The `preview` variant
  is untouched.
- Filtering matches against **the text the cell actually renders** — the existing `formatCell`
  output, reused rather than reimplemented — so a match is always visible in the cell that matched.
  This is what makes filtering a map-classified column (HEL-1015) explainable rather than arbitrary.
- `TableRenderer` filters the normalized row set **before** the existing `useSortedRows` call, so
  filtering and sorting compose in one pipeline rather than fighting over row order.
- `DataGrid`'s empty state gains an **action slot** and a distinct filtered-empty message. Today it
  is a bare `<p>{emptyText}</p>`; a filter that matches nothing currently renders as an empty table
  with no explanation and no way out.
- The UI states the scope of what it filtered whenever the row set is truncated, and never presents
  a bare match count that could be read as a whole-Output count.
- Filter state persists as `columnFilters`, a flat sibling of `columnSort` on `TableOutputConfig`,
  written with the same minimal-patch, activation-only, owner-pre-checked path HEL-448 established.

Not a breaking change: `columnFilters` is optional, and an Output without it renders as it does now.

## Capabilities

### New Capabilities

- `table-panel-column-filtering`: Output-scoped persisted filter state for table panels — storage
  shape on `TableOutputConfig`, absent-field default, the match predicate (rendered-text contains,
  quick-filter across columns, per-column AND), composition with sort, and the loaded-scope
  disclosure obligations that follow from filtering a fetched sample.

### Modified Capabilities

- `data-grid`: the `full` variant gains an optional filter row and an empty state that can carry a
  message and an action, replacing the message-only empty state.

## Impact

- `frontend/src/shared/ui/DataGrid.tsx` — filter row rendering, `filters`/`onFilterChange` props,
  empty-state action slot; `formatCell` reused as the match source.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — filter predicate applied before
  `useSortedRows`, the persist round trip, and the loaded-scope disclosure.
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` — `columnFilters` beside
  `columnSort`, read tolerantly.
- `frontend/src/features/panels/ui/PanelContent.tsx` — passes stored filters through.
- Styling for the filter row and the extended empty state.
- No backend change, no migration, no new endpoint.

## Non-goals

- Typed operators (>, <, ranges, date pickers) — contains only.
- A server-side filter parameter, or any count describing the whole Output. Both are owned by
  HEL-1027 (open; retitled to cover filter and counts).
- Filtering on the `preview` variant.
- Multi-value or OR semantics within a single column.
- Building HEL-465 / HEL-469 — only leaving room for them beside `columnFilters`.
