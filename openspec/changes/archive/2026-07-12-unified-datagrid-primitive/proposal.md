## Why

Table-shaped UI is currently duplicated across five surfaces (`PreviewTable`, the pipeline
step-preview table in `StepCard`, the schema preview table in `SqlTab`, and the table-panel
`TableRenderer`), each with its own markup, CSS, empty-state text, and cell formatting. This epic
(HEL-240) needs a single canonical grid to build density, draggable widths, and a scroll fix on
top of — those follow-on tickets require one component to land features on, not five.

## What Changes

- Add `DataGrid` at `frontend/src/shared/ui/DataGrid.tsx` (existing shared-primitive location, not
  the ticket's literal `components/ui/` sketch — see design.md Decision 1): rows/columns-driven,
  with `variant` (`full` | `preview`), `density` (`condensed` | `normal` | `spacious`), and
  `emptyText` props, optional `ColumnDef[]` (falls back to deriving columns from row keys), a
  shared empty state, and shared cell formatting (`null`/`undefined` → `—`, objects → JSON).
- Migrate `PreviewTable` call sites (`TypeDetailPanel`, `SourceDetailPanel`,
  `PipelinePreviewModal`) to `DataGrid variant="preview"`; delete `PreviewTable`.
- Migrate the inline step-preview table in `StepCard.tsx` (rendered inside `PipelineDetailPage`;
  class prefix `pipeline-detail-page__step-preview-*`) to `DataGrid variant="preview"`.
- Migrate the schema preview table in `SqlTab.tsx` to `DataGrid`, with a `ColumnDef.render` for
  the `Nullable` boolean-to-yes/no cell.
- Migrate `TableRenderer` (`PanelContent`, `type="table"`) to `DataGrid variant="full"`,
  preserving pagination (`Load more` button renders below the grid, outside `DataGrid` itself) and
  the unbound/skeleton placeholder state.
- Give `PipelinePreviewModal`'s "not yet run" message its own local style — it currently borrows
  `PreviewTable.css`'s `.preview-table__empty` class directly (not through the `PreviewTable`
  component), which breaks once that stylesheet is deleted.
- Delete all superseded table CSS (`PreviewTable.css` and the per-surface `__table` rules) in
  favor of `DataGrid`'s own stylesheet, built on existing design tokens.

## Non-goals

- `RunHistoryModal`'s row-count is a flex-row summary field (`run-history-modal__row-count`), not
  a `<table>` — not migrated.
- `TypeDetailPanel`'s editable field-schema table and `SourceDetailPanel`'s read-only
  inferred-schema table are pre-existing, out-of-scope surfaces the prior (skeptic-approved)
  design also excluded — only each panel's `PreviewTable`-backed *preview* section migrates.
- No density toggle, draggable column widths, or new table-panel config UI — subsequent tickets.
- No backend/API/schema changes; frontend-only component consolidation.

## Capabilities

### New Capabilities
- `data-grid`: the shared `DataGrid` component's contract — row/column rendering, `variant`,
  `density`, empty state, and custom cell rendering via `ColumnDef.render`.

### Modified Capabilities
(none — existing specs, e.g. `panel-type-rendering`, `pipeline-step-preview`, describe rendering
outcomes that are preserved; no requirement-level behavior changes.)

## Impact

- **New**: `frontend/src/shared/ui/DataGrid.tsx` (+ stylesheet, + tests).
- **Modified**: `TypeDetailPanel.tsx`, `SourceDetailPanel.tsx`, `PipelinePreviewModal.tsx`,
  `StepCard.tsx`, `SqlTab.tsx`, `PanelContent.tsx`'s `renderers/TableRenderer.tsx`,
  `frontend/src/shared/ui/index.ts` (barrel export), `PipelineDetailPage.css`,
  `PanelContent.css`.
- **Deleted**: `frontend/src/features/panels/ui/PreviewTable.tsx` + `PreviewTable.css`, and the
  table-specific CSS blocks each migrated surface owned.
- No backend, schema, or API changes.
