## 1. Backend — Repository

- [x] 1.1 Add `duplicate(id: DashboardId): Future[Option[(Dashboard, Vector[Panel])]]` to `DashboardRepository` — fetches source dashboard + panels, assigns new UUIDs, remaps layout panel IDs, inserts both in a single `transactionally` block
- [x] 1.2 Add `DuplicateDashboardResponse(dashboard: DashboardResponse, panels: Vector[PanelResponse])` case class and JSON format to `JsonProtocols`

## 2. Backend — Route

- [x] 2.1 Add `POST /api/dashboards/:id/duplicate` route to `DashboardRoutes` — calls `dashboardRepo.duplicate`, returns `201 Created` with `DuplicateDashboardResponse` or `404 Not Found`

## 3. Backend — Tests

- [x] 3.1 Add `ApiRoutesSpec` tests for `POST /api/dashboards/:id/duplicate`: success (dashboard + panels copied, layout remapped, name has `(copy)` suffix), source not found (404), dashboard with no panels

## 4. Frontend — Service

- [x] 4.1 Add `duplicateDashboard(dashboardId: string): Promise<DuplicateDashboardResponse>` to `dashboardService.ts`
- [x] 4.2 Add `DuplicateDashboardResponse` type to `types/models.ts`

## 5. Frontend — Redux

- [x] 5.1 Add `duplicateDashboard` async thunk to `dashboardsSlice` — calls service, returns `DuplicateDashboardResponse`
- [x] 5.2 Handle `duplicateDashboard.fulfilled` in `dashboardsSlice.extraReducers` — prepend new dashboard to `items`, set `selectedDashboardId`
- [x] 5.3 Handle `duplicateDashboard.fulfilled` in `panelsSlice.extraReducers` — set `items` to new panels, set `loadedDashboardId` to new dashboard id, set `status` to `"succeeded"`

## 6. Frontend — UI

- [x] 6.1 Enable the "Duplicate" menu item in `DashboardList.tsx` — wire it to `dispatch(duplicateDashboard(dashboard.id))`

## 7. Verification

- [x] 7.1 Run `sbt test` in `backend/` — all tests pass
- [x] 7.2 Run `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` in `frontend/` — all pass
- [x] 7.3 Playwright smoke test: duplicate a dashboard with panels, verify new dashboard appears and is selected, verify panels are present, verify original is unchanged
