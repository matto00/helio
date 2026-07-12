## 1. Frontend: DataGrid primitive

- [x] 1.1 Port `frontend/src/shared/ui/DataGrid.tsx` (+ `DataGrid.css`, + `DataGrid.test.tsx`) from
      the preserved reference at
      `/tmp/claude-1000/-home-matt-Development-helio/8a509d43-82ec-495d-9b4d-d99b91d883d1/scratchpad/hel251-reference/DataGrid/`
      — net-new files, no conflict with current `main`. Verify `rows`, `columns?`, `variant`,
      `density?`, `emptyText?`, `className?` props; column derivation from row keys (first 50
      rows, first-seen order) when `columns` is omitted
- [x] 1.2 Confirm default cell formatting (null/undefined → `—`, objects → `JSON.stringify`, else
      `String(value)`) and `ColumnDef.render(row, value)` override — this normalizes cell display
      vs. `TableRenderer`/`StepCard`'s current inline formatting (blank/bare-string); see
      design.md Decision 3, the one acknowledged visual delta in this change
- [x] 1.3 Confirm empty state: renders `emptyText` (default `"No data to preview."`) instead of a
      `<table>` when `rows` is empty
- [x] 1.4 Confirm `variant`/`density` defaulting (`preview` → `condensed`, `full` → `normal`,
      explicit `density` always wins) and `ui-data-grid` CSS using existing design tokens
- [x] 1.5 Export `DataGrid` (and `ColumnDef` type) from `frontend/src/shared/ui/index.ts`

## 2. Frontend: migrate PreviewTable call sites

- [x] 2.1 Replace `PreviewTable` usage in `TypeDetailPanel.tsx:196-199` with `<DataGrid
      variant="preview" emptyText="No rows have been written to this type yet. Run a pipeline
      that writes to this type to populate it." />`
- [x] 2.2 Replace `PreviewTable` usage in `SourceDetailPanel.tsx:127-131` with `<DataGrid
      variant="preview" emptyText="Source returned no rows." />`; the current `headers: string[]`
      prop maps to `columns={headers?.map((h) => ({ key: h }))}`
- [x] 2.3 Replace `PreviewTable` usage in `PipelinePreviewModal.tsx:40` with `<DataGrid
      variant="preview" emptyText="Pipeline returned no rows." />`. Also give the sibling "not yet
      run" paragraph (`PipelinePreviewModal.tsx:35`, `className="preview-table__empty"`) its own
      local style: add `PipelinePreviewModal.css` with a `.pipeline-preview-modal__empty` rule
      (same tokens as the old `.preview-table__empty`) and import it — this class is currently
      borrowed from `PreviewTable.css` and would break once that stylesheet is deleted
      (design.md Decision 6)
- [x] 2.4 Re-grep `frontend/src` for any remaining `PreviewTable` consumers beyond the three above
      (confirm none exist on current `main` before deleting); delete
      `frontend/src/features/panels/ui/PreviewTable.tsx` and `PreviewTable.css`

## 3. Frontend: migrate remaining table surfaces

- [x] 3.1 Replace the inline `pipeline-detail-page__step-preview-table` in `StepCard.tsx:236-260`
      with `<DataGrid variant="preview" emptyText="No rows to preview." />`; remove the
      superseded CSS rules in `PipelineDetailPage.css` (`.pipeline-detail-page__step-preview-table
      -wrapper`, `-table`, and its `tbody tr:hover` rule)
- [x] 3.2 Replace the schema preview `add-source-modal__fields-table` in `SqlTab.tsx:210-227` with
      `<DataGrid variant="preview" />`, keeping the existing `inferredFields !== null &&
      inferredFields.length > 0` guard (never hand `DataGrid` an empty array here — the
      zero-fields case keeps its own paragraph). Cast `inferredFields` (type `InferredField[]`) to
      satisfy `rows: Record<string, unknown>[]`; the `Nullable` column's `f.nullable ? "yes" :
      "no"` becomes a `ColumnDef.render`
- [x] 3.3 Replace `TableRenderer.tsx`'s two data-bearing render paths (paginated rows: lines 20-68;
      raw rows: lines 70-94) with a thin wrapper around `<DataGrid variant="full" />`, keeping the
      "Load more" button and its loading/disabled state as sibling markup outside `DataGrid`. Keep
      the existing aria-hidden skeleton (3×2 placeholder, lines 95-120) as bespoke sibling markup
      for the "no rows prop at all" (unbound panel) case — do NOT route it through `DataGrid`;
      only a bound-but-empty rows array goes to `DataGrid`'s own empty state. For the raw-rows
      path specifically, convert `rawRows: string[][]` + optional `headers` into `DataGrid`'s
      `rows`/`columns` contract per design.md Decision 7: `cols = headers ?? rawRows[0].map((_, i)
      => String(i + 1))`, `columns = cols.map((key) => ({ key }))`, `rows =
      rawRows.map((row) => Object.fromEntries(cols.map((key, i) => [key, row[i]])))` — preserves
      the current positional-label fallback and column order exactly, keeping
      `PanelContent.test.tsx`'s headers-omitted case (`rawRows={[["A"],["B"],["C"]]}`, no
      `headers` prop) green
- [x] 3.4 Remove now-unused `.panel-content__table` (+ `th`/`td` variants) CSS rules from
      `PanelContent.css` superseded by `DataGrid` — keep `.panel-content--table` (the layout
      wrapper div class; still used by the skeleton/load-more sibling markup)

## 4. Tests

- [x] 4.1 Confirm/adjust `DataGrid.test.tsx`: empty state, full variant, preview variant, custom
      column `render`, default cell formatting (null/undefined/object), column derivation from
      row keys
- [x] 4.2 Update/adjust existing tests for migrated surfaces (`TypeDetailPanel`,
      `SourceDetailPanel`, `PipelinePreviewModal`, `PipelineDetailPage`/`StepCard`, `SqlTab`/
      `AddSourceModal`, `TableRenderer`/`PanelContent`) so they assert against `DataGrid`'s
      rendered output instead of the deleted bespoke markup
- [x] 4.3 Run full frontend suite (`npm test`), lint, and format; fix any fallout
