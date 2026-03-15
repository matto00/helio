## Why

Without a defined sort order, `GET /api/dashboards` and `GET /api/dashboards/:id/panels` return items in arbitrary insertion order, giving the frontend no stable contract to rely on. Defining and enforcing `lastUpdated desc` sorting in the backend establishes a clear, persistent-storage-ready ordering contract before HEL-14 adds a real database.

## What Changes

- `GET /api/dashboards` returns dashboards sorted by `lastUpdated` descending (most recently updated first)
- `GET /api/dashboards/:id/panels` returns panels sorted by `lastUpdated` descending
- Backend owns sort responsibility — frontend receives pre-sorted data and does not need to re-sort
- Frontend `getMostRecentDashboardId` auto-selection is simplified: the first item in the response is always the most recently updated dashboard
- Backend `ApiRoutesSpec` gains sort-order coverage for both endpoints

## Capabilities

### New Capabilities

- `dashboard-ordering`: Backend sort contract for `GET /api/dashboards` — `lastUpdated desc`
- `panel-ordering`: Backend sort contract for `GET /api/dashboards/:id/panels` — `lastUpdated desc`

### Modified Capabilities

- `frontend-dashboard-selection-flow`: Auto-selection rule is now tied to the backend sort contract (first item = most recent) rather than a frontend-side reduce

## Impact

- `backend/src/main/scala/com/helio/app/DashboardRegistryActor.scala` — sort on `GetDashboards`
- `backend/src/main/scala/com/helio/app/PanelRegistryActor.scala` — sort on `GetPanels`
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — sort-order assertions
- `frontend/src/features/dashboards/dashboardsSlice.ts` — `getMostRecentDashboardId` simplified
- `frontend/src/features/dashboards/dashboardsSlice.test.ts` — tests updated to reflect contract
- No API shape changes (response structure unchanged, only item order)
