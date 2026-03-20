## Why

Dashboards and panels are named at creation but can't be renamed — any typo or stale name is permanent. Rename and title-edit are the most fundamental missing edit operations.

## What Changes

- `PATCH /api/dashboards/:id` extended to accept an optional `name` field; empty or whitespace-only values are rejected with 400
- `PATCH /api/panels/:id` extended to accept an optional `title` field; empty or whitespace-only values are rejected with 400
- Inline click-to-edit name field on each dashboard list item in the sidebar
- Inline title edit on each panel card (via the appearance editor or a direct control)
- Redux state updated on success: dashboard name or panel title reflected immediately

## Capabilities

### New Capabilities
- `dashboard-rename`: Rename a dashboard inline; backend validates and persists; sidebar updates immediately
- `panel-title-edit`: Edit a panel's title inline; backend validates and persists; panel card updates immediately

### Modified Capabilities

## Impact

- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — extend PATCH handlers to accept `name`/`title`
- `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala` — `rename(id, name)` method
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — `updateTitle(id, title)` method
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — new rename/title-edit tests
- `frontend/src/features/dashboards/dashboardsSlice.ts` — `renameDashboard` thunk
- `frontend/src/features/panels/panelsSlice.ts` — `updatePanelTitle` thunk
- `frontend/src/components/DashboardList.tsx` — inline editable name
- `frontend/src/components/PanelGrid.tsx` or `PanelAppearanceEditor.tsx` — inline editable title
