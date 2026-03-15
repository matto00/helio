## Why

`HEL-15` introduced the grid layout foundation and `HEL-16` added backend-backed appearance customization, but panel placement is still ephemeral. `HEL-17` makes dashboard layouts persist so drag and resize changes survive reloads, stay scoped to the selected dashboard, and turn the grid from a visual demo into real product behavior.

## What Changes

- Add a dashboard-owned `layout` object that stores responsive panel positions and sizes by breakpoint.
- Extend backend models, API responses, and update flows to persist dashboard layout state in memory.
- Load saved layouts into the frontend grid instead of always deriving placement from panel order.
- Persist `react-grid-layout` drag and resize changes back to the backend.
- Keep layout state compatible with dashboard selection, panel fetching, and appearance customization.

## Capabilities

### New Capabilities
- `dashboard-panel-layouts`: Store and return dashboard-owned responsive panel layout state.
- `frontend-layout-persistence`: Load and save panel layout changes from the frontend grid.

### Modified Capabilities
- `frontend-dashboard-polish`: Render persisted dashboard layouts within the existing grid foundation.
- `frontend-resource-appearance-editing`: Keep appearance customization compatible with persisted layouts.

## Impact

- `backend/src/main/scala/com/helio/domain/**`
- `backend/src/main/scala/com/helio/api/**`
- `backend/src/main/scala/com/helio/app/**`
- `backend/src/test/scala/com/helio/api/**`
- `frontend/src/components/**`
- `frontend/src/features/**`
- `frontend/src/services/**`
- `frontend/src/types/**`
- `schemas/*.json`
