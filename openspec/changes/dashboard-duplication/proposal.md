## Why

The dashboard actions menu already exposes a "Duplicate" option, but it is currently disabled. Enabling it gives users a fast way to clone a dashboard — including all its panels, layout, and appearance — without having to recreate it from scratch.

## What Changes

- New `POST /api/dashboards/:id/duplicate` backend endpoint that deep-copies a dashboard and all its panels with fresh UUIDs, names the copy `"{original name} (copy)"`, and returns the new dashboard and panel list
- Frontend enables the disabled "Duplicate" menu item in the dashboard actions menu
- On duplication success, the new dashboard is added to the Redux store and immediately selected in the sidebar

## Capabilities

### New Capabilities

- `dashboard-duplication`: Backend endpoint and frontend action for duplicating a dashboard with all its panels, layout, and appearance preserved

### Modified Capabilities

<!-- No existing spec-level requirements are changing -->

## Impact

- **Backend**: New route in `ApiRoutes.scala`; new message type and handler in `DashboardRegistryActor`; `PanelRegistryActor` gains a bulk-copy operation
- **Frontend**: `dashboardsSlice` gains a `duplicateDashboard` thunk; `DashboardActionsMenu` component enables the Duplicate menu item
- **Schemas/Specs**: New `dashboard-duplication` spec; OpenAPI spec gains the new endpoint
