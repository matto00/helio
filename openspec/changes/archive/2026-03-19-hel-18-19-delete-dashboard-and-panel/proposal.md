## Why

There is no way to delete dashboards or panels. Users accumulate clutter they can't clean up, and the DB grows with no lifecycle management. Delete is the most fundamental missing CRUD operation.

## What Changes

- `DELETE /api/dashboards/:id` — removes the dashboard and cascades to all its panels (FK cascade already defined in the schema)
- `DELETE /api/panels/:id` — removes an individual panel and its layout entry from the owning dashboard
- Delete button on each dashboard item in the sidebar with an inline confirmation step
- Delete button on each panel card (via the appearance editor or a dedicated control) with inline confirmation
- Redux state updated on success: dashboard removed from list; panel removed from list and from the dashboard layout

## Capabilities

### New Capabilities
- `dashboard-delete`: DELETE endpoint and frontend flow for removing a dashboard
- `panel-delete`: DELETE endpoint and frontend flow for removing a panel

### Modified Capabilities

## Impact

- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — two new DELETE routes
- `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala` — `delete(id)` method
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — `delete(id)` method
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — new delete tests
- `frontend/src/features/dashboards/dashboardsSlice.ts` — `deleteDashboard` thunk
- `frontend/src/features/panels/panelsSlice.ts` — `deletePanel` thunk
- `frontend/src/components/DashboardList.tsx` — delete button per item
- `frontend/src/components/PanelGrid.tsx` — delete control per panel
- No schema migrations needed (cascade is already defined)
