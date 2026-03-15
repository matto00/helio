## 1. Backend — Sort registry responses

- [x] 1.1 Sort `GetDashboards` response by `lastUpdated` descending in `DashboardRegistryActor`
- [x] 1.2 Sort `GetPanels` response by `lastUpdated` descending in `PanelRegistryActor`

## 2. Backend — Route tests

- [x] 2.1 Add `ApiRoutesSpec` test asserting `GET /api/dashboards` returns dashboards in `lastUpdated desc` order
- [x] 2.2 Add `ApiRoutesSpec` test asserting `GET /api/dashboards/:id/panels` returns panels in `lastUpdated desc` order

## 3. Frontend — Simplify auto-selection

- [x] 3.1 Simplify `getMostRecentDashboardId` in `dashboardsSlice.ts` to use first item (`items[0]`) rather than a reduce
- [x] 3.2 Update `dashboardsSlice.test.ts` to document that auto-selection relies on backend sort contract

## 4. Verification

- [x] 4.1 Run `sbt test` in `backend/` — all tests pass
- [x] 4.2 Run `npm test` and `npm run lint` and `npm run format:check` — all pass
- [x] 4.3 Run `npm run build` in `frontend/` — clean build
