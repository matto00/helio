## Why

Users need a way to share dashboard configurations or restore them without recreating panels and layout manually. Export/import gives users a portable, human-readable JSON snapshot of a full dashboard that can be shared between environments or used as a backup.

## What Changes

- New `GET /api/dashboards/:id/export` endpoint that returns a self-contained JSON snapshot containing the dashboard metadata, appearance, layout, and all its panels
- New `POST /api/dashboards/import` endpoint that accepts a snapshot and recreates the dashboard with fresh IDs — the original is never overwritten
- Invalid or malformed import payloads are rejected with a descriptive error
- Export button added to the dashboard actions menu in the sidebar
- Import option added to the dashboard create flow in the sidebar

## Capabilities

### New Capabilities

- `dashboard-export-import`: Backend export and import endpoints, frontend export action in the dashboard actions menu, and frontend import option in the create flow

### Modified Capabilities

<!-- No existing spec-level requirements are changing -->

## Impact

- **Backend**: New routes in `DashboardRoutes.scala`; new request/response case classes and JSON formats in `JsonProtocols.scala`; new `export` and `import` operations in `DashboardRepository.scala`
- **Frontend**: `dashboardService.ts` gains `exportDashboard` and `importDashboard` functions; `dashboardsSlice` gains corresponding thunks; `DashboardList.tsx` gains an Export action in the actions menu and an Import option in the create panel
- **Schemas/Specs**: New `dashboard-export-import` spec; no schema changes to existing JSON schemas
