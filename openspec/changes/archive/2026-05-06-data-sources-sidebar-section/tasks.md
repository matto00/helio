## 1. Frontend — New DataSourcesPage

- [x] 1.1 Create `frontend/src/pages/DataSourcesPage.tsx` that dispatches `fetchSources` and `fetchDataTypes` on mount and renders `DataSourceList` and `AddSourceModal`
- [x] 1.2 Register `/data-sources` route in the router (App.tsx or equivalent) pointing to `DataSourcesPage`

## 2. Frontend — Sidebar Navigation

- [x] 2.1 Add a "Data Sources" `NavLink` to `/data-sources` in the sidebar's main navigation, positioned between Dashboards and Sources

## 3. Frontend — Refactor SourcesPage

- [x] 3.1 Remove `DataSourceList` and `AddSourceModal` rendering from `SourcesPage`
- [x] 3.2 Remove `fetchSources` dispatch from `SourcesPage` mount effect (retain `fetchDataTypes`)
- [x] 3.3 Update the "Data Sources" heading / section container removal so `SourcesPage` renders only the Type Registry section

## 4. Tests

- [x] 4.1 Add a smoke test confirming `DataSourcesPage` renders the data source list and "Add source" button
- [x] 4.2 Update any existing `SourcesPage` tests that assert Data Sources content is present (remove those assertions or redirect them to `DataSourcesPage` tests)
- [x] 4.3 Add a test confirming the sidebar renders a "Data Sources" nav link pointing to `/data-sources`
