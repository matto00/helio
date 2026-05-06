## Why

The sidebar nav currently only has Dashboards and Data Sources. Data Pipelines is a first-class
concept in Helio v1.3 and needs its own top-level entry point so users can navigate to it directly
without the feature being buried or inaccessible.

## What Changes

- Add a "Data Pipelines" `NavLink` to the sidebar nav, positioned between Data Sources and Type Registry
- Register a `/pipelines` route inside the protected `AppShell`
- Create a `PipelinesPage` placeholder component rendered at `/pipelines`
- Update the command bar breadcrumb to display "Data Pipelines" when on that route

## Capabilities

### New Capabilities

- `frontend-pipelines-page`: Placeholder page at `/pipelines` with "coming soon" empty state,
  registered as a protected route and linked from the sidebar nav between Data Sources and Type Registry

### Modified Capabilities

- `frontend-protected-routes`: The `/pipelines` route is added inside `ProtectedRoute` alongside `/` and `/sources`

## Impact

- `frontend/src/app/App.tsx` — add NavLink, route, breadcrumb branch
- `frontend/src/components/PipelinesPage.tsx` — new placeholder component (no backend calls)
- No backend changes; no API contract changes; no schema changes

## Non-goals

- Actual pipeline data, CRUD operations, or backend wiring
- Type Registry nav item (separate ticket)
