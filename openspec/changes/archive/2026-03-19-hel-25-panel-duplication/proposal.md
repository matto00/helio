## Why

There is no way to duplicate an existing panel. Users who want a second panel with the same appearance or as a starting point must recreate it manually from scratch. Duplication is a common productivity action in dashboard tools and removes friction when building multi-panel layouts.

## What Changes

- `POST /api/panels/:id/duplicate` backend endpoint — creates a new panel copying the title and appearance of the source, assigns a new ID, and returns the created panel
- Duplicate action on the panel card (alongside the existing appearance editor and drag handle)
- Duplicated panel is appended to the Redux panel list and a default layout entry is added to the dashboard layout for all breakpoints
- No schema migration required — the existing `panels` table and domain model support the duplicate without changes

## Capabilities

### New Capabilities
- `panel-duplication`: Server-side duplicate endpoint and frontend flow for copying a panel within a dashboard

### Modified Capabilities

## Impact

- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — `duplicate(id: PanelId): Future[Option[Panel]]`
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `POST /api/panels/:id/duplicate` route
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — new duplicate tests
- `frontend/src/services/panelService.ts` — `duplicatePanel(panelId)` service call
- `frontend/src/features/panels/panelsSlice.ts` — `duplicatePanel` thunk
- `frontend/src/components/PanelGrid.tsx` — duplicate button per panel card
