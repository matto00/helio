## 1. Backend — DashboardRepository

- [x] 1.1 Add `updateName(id: DashboardId, name: String, lastUpdated: Instant): Future[Option[Dashboard]]` method — returns updated dashboard or None if not found

## 2. Backend — PanelRepository

- [x] 2.1 Add `updateTitle(id: PanelId, title: String, lastUpdated: Instant): Future[Option[Panel]]` method — returns updated panel or None if not found

## 3. Backend — ApiRoutes

- [x] 3.1 Add `name` field to `UpdateDashboardRequest`; update `validateDashboardUpdateRequest` to accept `name | appearance | layout` (at least one required); reject blank `name` with 400
- [x] 3.2 In the dashboard PATCH handler, call `dashboardRepo.updateName()` when `name` is present and valid
- [x] 3.3 Add `title` to panel PATCH handling; reject blank `title` with 400; call `panelRepo.updateTitle()` when present

## 4. Backend — Tests

- [x] 4.1 Add test: rename dashboard returns 200 with updated name
- [x] 4.2 Add test: rename with empty/whitespace name returns 400
- [x] 4.3 Add test: rename non-existent dashboard returns 404
- [x] 4.4 Add test: update panel title returns 200 with updated title
- [x] 4.5 Add test: update panel title with empty/whitespace returns 400
- [x] 4.6 Add test: update panel title for non-existent panel returns 404

## 5. Frontend — dashboardsSlice

- [x] 5.1 Add `renameDashboard` async thunk calling `PATCH /api/dashboards/:id` with `{ name }`
- [x] 5.2 Handle fulfilled: update the dashboard name in `items`

## 6. Frontend — panelsSlice

- [x] 6.1 Add `updatePanelTitle` async thunk calling `PATCH /api/panels/:id` with `{ title }`
- [x] 6.2 Handle fulfilled: update the panel title in `items`

## 7. Frontend — DashboardList

- [x] 7.1 Make the dashboard name in each list item an inline-editable field (click to activate, Enter/blur to confirm, Escape to cancel)
- [x] 7.2 Dispatch `renameDashboard` on confirm; show inline error and block submit if input is empty

## 8. Frontend — PanelGrid / PanelAppearanceEditor

- [x] 8.1 Add an inline-editable title field to each panel card header (activate via double-click or a dedicated edit affordance, Enter/blur to confirm, Escape to cancel)
- [x] 8.2 Dispatch `updatePanelTitle` on confirm; show inline error and block submit if input is empty

## 9. Verification

- [x] 9.1 Run `sbt test` — all backend tests pass
- [x] 9.2 Run `npm test` — all frontend tests pass
- [x] 9.3 Run `npm run lint` and `npm run format:check` — clean
- [x] 9.4 Visual check: rename dashboard and edit panel title flows work end-to-end
