## 1. Frontend

- [ ] 1.1 Create `frontend/src/components/TypeRegistryPage.tsx` — dispatches `fetchDataTypes` on mount, renders loading state and `TypeRegistryBrowser`
- [ ] 1.2 Add `/registry` route in `App.tsx` inside `AppShell` routes, rendering `TypeRegistryPage`
- [ ] 1.3 Add "Type Registry" `NavLink` to the sidebar nav in `App.tsx` (peer to "Dashboards" and "Data Sources")
- [ ] 1.4 Extend breadcrumb logic in `AppShell` to map `/` → "Dashboards", `/sources` → "Data Sources", `/registry` → "Type Registry"
- [ ] 1.5 Remove the Type Registry section (heading, loading state, `TypeRegistryBrowser`) from `SourcesPage.tsx`
- [ ] 1.6 Remove `fetchDataTypes` dispatch from `SourcesPage.tsx` `useEffect`

## 2. Tests

- [ ] 2.1 Update `SourcesPage.test.tsx` — remove assertions about Type Registry section being present; verify `fetchDataTypes` is not dispatched
- [ ] 2.2 Add or update `App.test.tsx` — verify "Type Registry" nav link is present in sidebar and `/registry` route renders `TypeRegistryPage`
