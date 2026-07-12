- `frontend/src/shared/ui/DataGrid.tsx` — new canonical `DataGrid` primitive (ported from the
  preserved reference build); rows/columns-driven table with `variant`, `density`, `emptyText`,
  default cell formatting, and `ColumnDef.render` override.
- `frontend/src/shared/ui/DataGrid.css` — `DataGrid`'s stylesheet (`ui-data-grid` class prefix),
  built on existing `--app-*`/`--space-*`/`--text-*` tokens.
- `frontend/src/shared/ui/DataGrid.test.tsx` — unit tests: empty state (default + custom
  `emptyText`), column derivation vs. explicit columns, full/preview variant + density defaulting
  and override, default cell formatting (null/undefined/object/other), custom column `render`.
- `frontend/src/shared/ui/index.ts` — barrel-exports `DataGrid` and the `ColumnDef` type.
- `frontend/src/features/dataTypes/ui/TypeDetailPanel.tsx` — replaced `PreviewTable` with
  `DataGrid variant="preview"`, preserving its existing `emptyText`.
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` — replaced `PreviewTable` with
  `DataGrid variant="preview"`; the `headers: string[]` prop maps to
  `columns={headers?.map((h) => ({ key: h }))}`.
- `frontend/src/features/pipelines/ui/PipelinePreviewModal.tsx` — replaced `PreviewTable` with
  `DataGrid variant="preview"`; the "not yet run" paragraph now uses its own
  `pipeline-preview-modal__empty` class instead of borrowing `preview-table__empty`.
- `frontend/src/features/pipelines/ui/PipelinePreviewModal.css` — new stylesheet, one rule
  (`.pipeline-preview-modal__empty`) replacing the borrowed `PreviewTable.css` class (design.md
  Decision 6).
- `frontend/src/features/panels/ui/PreviewTable.tsx` — deleted (superseded by `DataGrid`; re-grep
  confirmed only the three call sites above referenced it).
- `frontend/src/features/panels/ui/PreviewTable.css` — deleted alongside the component.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — replaced the inline step-preview `<table>`
  with `DataGrid variant="preview"`; `DataGrid`'s own empty state now covers the
  "no rows to preview" case (removed the separate manual `previewRows.length === 0` branch, since
  it duplicated `DataGrid`'s built-in empty-state text).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — removed the superseded
  `pipeline-detail-page__step-preview-{table-wrapper,table,th,td}` rules and the `tbody tr:hover`
  rule (all now unused since `StepCard`'s table markup is gone); kept `-loading`/`-error` state
  text styles (still used) and dropped the now-orphaned `-empty` selector from that group.
- `frontend/src/features/sources/ui/SqlTab.tsx` — replaced the schema-preview `<table>` with
  `DataGrid variant="preview"`, casting `InferredField[]` to `Record<string, unknown>[]` at the
  call site; the `Nullable` column uses `ColumnDef.render`. `SqlTab`'s existing
  `inferredFields.length > 0` guard is unchanged (zero-fields case still gets its own paragraph,
  `DataGrid` never receives an empty array here).
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — both data-bearing paths
  (paginated rows, raw rows) now render `DataGrid variant="full"`; the raw-rows path converts
  `string[][]` + optional `headers` into `DataGrid`'s `rows`/`columns` contract per design.md
  Decision 7 (preserves the positional `"1"`, `"2"`, ... fallback and column order exactly). The
  "Load more" button/loading state stays as sibling markup outside `DataGrid`; the aria-hidden 3×2
  skeleton (unbound-panel case) is untouched, still bespoke `<table>` markup, not routed through
  `DataGrid`.
- `openspec/changes/unified-datagrid-primitive/tasks.md` — all 16 tasks marked complete.

## Deviation from tasks.md 3.4

Task 3.4 said to remove `.panel-content__table` (+ `th`/`td` variants) CSS from `PanelContent.css`
as "now-unused." That premise doesn't hold: `TableRenderer`'s retained aria-hidden 3×2 skeleton
(the "no rows prop at all" / unbound-panel case, task 3.3's explicit non-goal for `DataGrid`
routing) still renders `<table className="panel-content__table" aria-hidden="true">` — deleting
that CSS would strip the skeleton's borders/sizing, a visual regression the ticket doesn't call
for. Kept `.panel-content__table` (base rule, `th`/`td` variant, and the container-query variant)
unchanged in `PanelContent.css`; `.panel-content--table` (the layout wrapper, task 3.4's other
instruction) was already untouched. No files were added/removed beyond what's listed above as a
result of this deviation — this is a keep-not-delete correction inside `PanelContent.css`.
