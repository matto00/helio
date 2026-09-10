## Why

Wide Table panels (many columns, e.g. sort/filter/formatted data from HEL-448/451/469) force
users to scroll away from identifying columns (name, id) to see later data. HEL-253 (resize) and
HEL-255 (order/visibility) already ship; pinning leading columns to the left edge while the rest
of the table scrolls is the remaining gap (HEL-465).

## What Changes

- Add a `pinnedColumns: string[]` config field to `full`-variant `DataGrid`, rendering pinned
  columns with `position: sticky; left: <offset>` while the rest of the table scrolls beneath a
  visible separator (a non-inset trailing `box-shadow`, DESIGN.md §3 token).
- Add a keyboard-operable pin/unpin toggle to the column header, alongside the existing sort
  button and resize handle (DESIGN.md §8).
- Persist `pinnedColumns` as a **flat sibling field on `TableOutputConfig`**
  (`frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts`), written via
  `updateOutput` from `TableRenderer.tsx`, mirroring the existing `persistColumnSort`/
  `persistColumnFilters` idiom — **not** `panel.config`/`panelsSlice.ts`, which no longer carries
  table column state (HEL-909 retired the bound `TablePanelConfig`; see design.md Context).
- Sticky offset math sums preceding pinned columns' widths (`columnWidths` fallback to
  `DEFAULT_COLUMN_WIDTH`, since `columnWidths` is session-local per HEL-909 — see design.md
  Decision 3) per the table's fixed panel-surface density.
- Decision: pin is constrained to the **leading ordered columns** (pinning a column pins every
  column ahead of it in the current order too) — see `design.md` for the full rationale.

## Capabilities

### New Capabilities
- `table-panel-column-pinning`: pin/unpin affordance, persisted `pinnedColumns` state on
  `TableOutputConfig`, and its interaction with column order.

### Modified Capabilities
- `data-grid`: sticky-left rendering and offset computation for pinned columns in the `full`
  variant.

## Impact

- `frontend/src/shared/ui/DataGrid.tsx` / `DataGrid.css` — sticky-left column rendering, offset
  computation, opaque pinned-cell backgrounds, z-index scale, separator styling.
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` — `pinnedColumns?:
  string[]` flat sibling on `TableOutputConfig`.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — leading-run derivation, pin
  toggle wiring, `persistPinnedColumns` (mirrors `persistColumnSort`/`persistColumnFilters`,
  same debounce/silent-swallow/`canWrite` pre-check).
- No backend/migration risk: `Output.config` is an opaque JSON blob; `mergeConfig`
  (`backend/.../pipelines/OutputService.scala`) shallow-merges it, so clearing `pinnedColumns`
  to empty MUST write `[]`, never omit the key (design.md Decision 6).

## Non-goals

- Right-edge pinning (out of scope per ticket).
- Pinning on the `preview` variant.
- Server-side sort/filter interplay (HEL-1027, unrelated).
- Persisting `columnWidths` itself (already session-local pre-existing behavior, unchanged by
  this ticket — see design.md Decision 2 for the accepted consequence on reload).
