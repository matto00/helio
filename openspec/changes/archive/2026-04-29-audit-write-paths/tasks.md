## 1. Audit

- [x] 1.1 Read `frontend/src/services/dashboardService.ts` and list every `httpClient.patch` / `httpClient.post` call with its endpoint and payload shape
- [x] 1.2 Read `frontend/src/services/panelService.ts` and list every `httpClient.patch` / `httpClient.post` call with its endpoint and payload shape
- [x] 1.3 Trace each service call back to its Redux thunk in `dashboardsSlice.ts` and `panelsSlice.ts` to confirm trigger and frequency
- [x] 1.4 Read `PanelGrid.tsx` to document the layout-change debounce (250 ms, one call per drag/resize-stop)
- [x] 1.5 Read `PanelDetailModal.tsx` to document panel appearance and data-binding write paths
- [x] 1.6 Read `DashboardAppearanceEditor.tsx` to document dashboard appearance write path
- [x] 1.7 Read `DashboardList.tsx` to document dashboard rename, create, duplicate, and import write paths

## 2. Spec

- [x] 2.1 Create `openspec/specs/write-path-audit/spec.md` with the full audit table: endpoint, trigger, payload shape, frequency-per-session estimate for each write path
- [x] 2.2 Verify all `httpClient.patch` and `httpClient.post` calls in service files appear in the spec (no undocumented paths)
- [x] 2.3 Confirm the spec records the layout-debounce note (1 call per drag/resize-stop, not per event)
