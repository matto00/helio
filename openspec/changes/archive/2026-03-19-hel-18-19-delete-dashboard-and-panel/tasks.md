## 1. Database migration

- [x] 1.1 Create `V2__cascade_delete.sql` adding `ON DELETE CASCADE` to the `panels.dashboard_id` FK constraint

## 2. Backend — DashboardRepository

- [x] 2.1 Add `delete(id: DashboardId): Future[Boolean]` method — returns true if a row was deleted, false if not found

## 3. Backend — PanelRepository

- [x] 3.1 Add `delete(id: PanelId): Future[Boolean]` method — returns true if a row was deleted, false if not found

## 4. Backend — ApiRoutes

- [x] 4.1 Add `DELETE /api/dashboards/:id` route — 204 on success, 404 if not found
- [x] 4.2 Add `DELETE /api/panels/:id` route — 204 on success, 404 if not found

## 5. Backend — Tests

- [x] 5.1 Add test: delete dashboard returns 204 and removes it from the DB
- [x] 5.2 Add test: delete dashboard cascades to its panels
- [x] 5.3 Add test: delete non-existent dashboard returns 404
- [x] 5.4 Add test: delete panel returns 204 and removes it from the DB
- [x] 5.5 Add test: delete non-existent panel returns 404

## 6. Frontend — dashboardsSlice

- [x] 6.1 Add `deleteDashboard` async thunk calling `DELETE /api/dashboards/:id`
- [x] 6.2 Handle fulfilled: remove dashboard from `items`; if it was `selectedDashboardId`, clear it and mark panels stale

## 7. Frontend — panelsSlice

- [x] 7.1 Add `deletePanel` async thunk calling `DELETE /api/panels/:id`
- [x] 7.2 Handle fulfilled: remove panel from `items`

## 8. Frontend — DashboardList

- [x] 8.1 Add delete button to each dashboard list item
- [x] 8.2 Implement inline confirmation (first click arms it, second click confirms, click-away cancels)
- [x] 8.3 After successful delete, dispatch `updateDashboardLayout` to prune layout if needed (panels already cascade-deleted)

## 9. Frontend — PanelGrid

- [x] 9.1 Add delete button to each panel card
- [x] 9.2 Implement inline confirmation on the panel card
- [x] 9.3 After successful panel delete, dispatch layout update to prune the deleted panel's ID from all breakpoints

## 10. Verification

- [x] 10.1 Run `sbt test` — all backend tests pass
- [x] 10.2 Run `npm test` — all frontend tests pass
- [x] 10.3 Run `npm run lint` and `npm run format:check` — clean
- [x] 10.4 Visual check: delete dashboard and panel flows work correctly end-to-end
