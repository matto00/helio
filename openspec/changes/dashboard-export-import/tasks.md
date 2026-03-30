## 1. Backend — Domain Types

- [x] 1.1 Add `DashboardSnapshotPanelEntry`, `DashboardSnapshotDashboardEntry`, and `DashboardSnapshotPayload` case classes to `JsonProtocols.scala` with their Spray JSON implicit formats

## 2. Backend — Repository

- [x] 2.1 Add `exportSnapshot(id: DashboardId): Future[Option[DashboardSnapshotPayload]]` to `DashboardRepository` — fetches dashboard + panels and maps to snapshot format (panel IDs become `snapshotId` strings, `meta` excluded)
- [x] 2.2 Add `importSnapshot(payload: DashboardSnapshotPayload): Future[(Dashboard, Vector[Panel])]` to `DashboardRepository` — assigns new UUIDs, builds `snapshotId → newId` map, remaps layout, inserts dashboard + panels in a single `transactionally` block

## 3. Backend — Route

- [x] 3.1 Add `GET /api/dashboards/:id/export` to `DashboardRoutes` — calls `dashboardRepo.exportSnapshot`, returns `200 OK` with `DashboardSnapshotPayload` or `404 Not Found`
- [x] 3.2 Add import payload validation helper to `DashboardRoutes` — validates `version` present, `dashboard.name` non-empty, all panel entries have valid `type` via `PanelType.fromString`, and all layout `panelId` values appear in the panels `snapshotId` set; returns `Left(errorMessage)` on failure
- [x] 3.3 Add `POST /api/dashboards/import` to `DashboardRoutes` — validates payload, calls `dashboardRepo.importSnapshot`, returns `201 Created` with `DuplicateDashboardResponse` or `400 Bad Request`

## 4. Backend — Tests

- [x] 4.1 Add `ApiRoutesSpec` tests for `GET /api/dashboards/:id/export`: success (snapshot shape, no IDs/meta in output), dashboard with no panels, dashboard not found (404)
- [x] 4.2 Add `ApiRoutesSpec` tests for `POST /api/dashboards/import`: success (new IDs assigned, layout remapped, 201 + DuplicateDashboardResponse), missing version (400), empty dashboard name (400), invalid panel type (400), layout references unknown snapshotId (400)

## 5. Frontend — Service and Types

- [x] 5.1 Add `DashboardSnapshot` interface to `types/models.ts` (matching `DashboardSnapshotPayload` shape: `version`, `dashboard`, `panels`)
- [x] 5.2 Add `exportDashboard(dashboardId: string, dashboardName: string): Promise<void>` to `dashboardService.ts` — calls `GET /api/dashboards/:id/export`, serializes response to a `Blob`, triggers browser download as `<dashboardName>.json`
- [x] 5.3 Add `importDashboard(snapshot: DashboardSnapshot): Promise<DuplicateDashboardResponse>` to `dashboardService.ts` — calls `POST /api/dashboards/import` with the snapshot body

## 6. Frontend — Redux

- [x] 6.1 Add `exportDashboard` async thunk to `dashboardsSlice` — calls service; no state mutation on success (download is a side effect), surfaces error via `rejectWithValue`
- [x] 6.2 Add `importDashboard` async thunk to `dashboardsSlice` — calls service, returns `DuplicateDashboardResponse`
- [x] 6.3 Handle `importDashboard.fulfilled` in `dashboardsSlice.extraReducers` — push new dashboard to `items`, set `selectedDashboardId` to new dashboard id
- [x] 6.4 Handle `importDashboard.fulfilled` in `panelsSlice.extraReducers` — set `items` to new panels, set `loadedDashboardId`, set `status` to `"succeeded"` (mirrors `duplicateDashboard.fulfilled` handler)

## 7. Frontend — UI

- [x] 7.1 Add "Export" item to `ActionsMenu` in `DashboardList.tsx` — dispatches `exportDashboard({ dashboardId: dashboard.id, dashboardName: dashboard.name })`; display inline error if the thunk rejects
- [x] 7.2 Add import file input to the create panel in `DashboardList.tsx` — a `<input type="file" accept=".json">` that reads the selected file with `FileReader`, parses the JSON, dispatches `importDashboard`, and handles loading/error state inline using the existing `isSaving`/`createError` pattern

## 8. Verification

- [x] 8.1 Run `sbt test` in `backend/` — all tests pass
- [x] 8.2 Run `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` in `frontend/` — all pass
- [ ] 8.3 Playwright smoke test: export a dashboard with panels, verify the downloaded JSON contains the correct shape and no server IDs; import the file, verify a new dashboard appears with the same name and panels; verify the original is unchanged
