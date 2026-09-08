## Why

Table panels render rows in raw source order with no way to reorder them. A user looking at a
loaded table cannot answer "which row is largest/smallest/first alphabetically" without leaving the
panel. `DataGrid` already owns resize, density and column-order affordances, so sort is the missing
member of an otherwise complete set of in-panel column controls — and it is the first of four
lane tickets (HEL-451 filtering, HEL-465 pinning, HEL-469 cell formatting) that all need the same
persisted per-column state slot.

## What Changes

- `DataGrid` (`full` variant only) gains sortable column headers built from HEL-1022's shared
  sorting system: activating a header toggles ascending <-> descending. **Two-state — there is no
  third, unsorted activation.** The header uses `SortableTh`'s exact FontAwesome glyph set,
  `aria-sort` vocabulary, whole-header-is-the-button interaction and CSS classes.
- **No new comparator is written.** Ordering comes from `useSortedRows` as shipped, inheriting its
  two already-solved edge cases (nulls last in both directions; `Instant.toString()` shapes parsed
  to epoch millis). Only a small `getValue` adapter coerces the panel's `unknown` cell values into
  the hook's `SortValue`.
- A never-sorted panel renders in the pipeline's own row order via a sentinel `defaultSort` key that
  matches no column, which `useSortedRows` already passes through unchanged.
- `TableRenderer` applies the sort across the whole loaded row set.
- Sort state is persisted on the Output's `TableOutputConfig` as `columnSort`, in the shared
  `SortState` shape (`{ key, direction }`) — the same vocabulary at rest and at runtime, no
  translation layer. Named `columnSort` because `TimelineOutputConfig.sort` already exists in that
  module.
- Persistence is a minimal `{ config: { columnSort } }` patch on a real user activation only, never
  on mount and never for the sentinel. A caller who cannot write the Output sorts session-locally,
  silently.
- A minimal truncation qualifier appears beside the existing "Load more" affordance when the row set
  is truncated, disclosing that the ranking covers only the loaded rows. Delivery-coordinator
  addition pending owner confirmation; deliberately trivially removable.

Not a breaking change: the new config field is optional, and an Output without it renders exactly
as it does today.

## Capabilities

### New Capabilities

- `table-panel-column-sort`: Output-scoped persisted sort state for table panels — storage shape on
  `TableOutputConfig`, absent-field default (unsorted), the write rules (activation-only, minimal
  patch, session-local for a non-owner), the numeric-aware/blanks-last/stable ORDERING GUARANTEES
  the panel surface must meet (met by reusing `useSortedRows` plus a boundary value adapter, not by
  writing a comparator), and application across the loaded row set.

### Modified Capabilities

- `data-grid`: the `full` variant gains a sortable-header affordance — activation cycle, direction
  indicator, `aria-sort`, keyboard operation, and non-interference with the existing resize handle.

## Impact

- `frontend/src/shared/ui/DataGrid.tsx` — sortable header rendering wired to the shared affordance;
  new optional `sort: SortState<string> | null` and `onSort: (key: string) => void` props. The
  `preview` variant is unaffected. The resize handle stays outside the header button and the `<th>`
  keeps its `style={{ width }}`, which is why `SortableTh` itself cannot be rendered directly.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — one pre-branch normalization
  feeding a single `useSortedRows` call, the sort-state round trip, and the truncation qualifier.
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` — `TableOutputConfig` gains
  `columnSort`, read tolerantly; the flat-sibling extension point is documented there for
  HEL-451/465/469.
- `frontend/src/features/panels/ui/PanelContent.tsx` — passes the stored sort through.
- Styling reuses `SortableTh`'s existing classes rather than adding a parallel family.
- No backend change, no migration, no new endpoint. Server-side sort is deferred to HEL-1027.

## Non-goals

- Multi-column sort.
- A third, clear-to-unsorted activation state.
- Forking or extending `useSortedRows`, `SortableTh` or `SortableTable`.
- A server-side sort endpoint or sorting rows the client has not loaded.
- Sort on the `preview` DataGrid variant.
- Building HEL-451 / HEL-465 / HEL-469 — only leaving room for them.
- Re-introducing table config onto the placement record, or restoring persistence for column
  widths (which HEL-909 removed and this ticket does not revive).
