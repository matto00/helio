## 1. Frontend — Remove Direct DataSource Binding Path

- [ ] 1.1 Update `usePanelData` hook: remove `sources` parameter, DataSource resolution, and direct `fetchCsvPreview`/`fetchRestPreview` calls
- [ ] 1.2 Wire all panel types in `usePanelData` to `fetchPanelPage` with `pageSize: 200` for chart, `pageSize: 10` for all others
- [ ] 1.3 Update `usePanelData` to read result rows and headers from `panelsSlice` page data state instead of local preview response state
- [ ] 1.4 Remove `sources` prop threading from `PanelGrid`, `PanelContainer`, and any other callers of `usePanelData`
- [ ] 1.5 Remove unused `fetchCsvPreview`/`fetchRestPreview` imports from panel rendering files
- [ ] 1.6 Ensure `PanelDetailModal` does not expose any DataSource (not DataType) selection control for panel binding

## 2. Frontend — PATCH Guard Documentation

- [ ] 2.1 Confirm `PATCH /api/panels/:id` (or `POST /api/panels/updateBatch`) schema does not include `dataSourceId`; add a comment in the relevant schema file if not already present

## 3. Tests

- [ ] 3.1 Update `usePanelData` tests to remove sources-slice mocking and assert `fetchPanelPage` is dispatched instead of preview fetches
- [ ] 3.2 Add test: bound metric panel dispatches `fetchPanelPage` with `pageSize: 10` on mount
- [ ] 3.3 Add test: bound chart panel dispatches `fetchPanelPage` with `pageSize: 200` on mount
- [ ] 3.4 Add test: unbound panel (typeId null) dispatches no fetch
- [ ] 3.5 Update or add test: PanelGrid / PanelContainer does not pass `sources` prop to `usePanelData`
