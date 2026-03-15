## Why

`HEL-9` is currently blocked by a frontend gap: dashboards can be fetched and selected, but users cannot create a dashboard from the UI through the real backend API. This keeps the product dependent on seeded data and prevents end-to-end dashboard lifecycle testing from the interface.

## What Changes

- Add a frontend `createDashboard` service call wired to `POST /api/dashboards`.
- Add a Redux async create flow in the dashboards slice.
- Add inline dashboard creation UI inside the dashboard list:
  - a `+` icon button to open create mode
  - an inline text field for dashboard name
  - a `Create dashboard` confirmation button
- On success, insert the created dashboard into frontend state and make it the active selection.
- Keep error handling explicit and local to the inline create flow.

## Capabilities

### New Capabilities
- `frontend-dashboard-creation`: Users can create dashboards from the frontend through the backend API.

### Modified Capabilities
- `frontend-dashboard-selection-flow`: Newly created dashboards become the active selection after creation.

## Impact

- `frontend/src/components/**`
- `frontend/src/features/dashboards/**`
- `frontend/src/services/dashboardService.ts`
- `frontend/src/app/App.test.tsx`
- `frontend/src/components/DashboardList.test.tsx`
