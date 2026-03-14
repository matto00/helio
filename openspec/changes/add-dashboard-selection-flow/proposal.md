## Why

The frontend can already load dashboards and lazily request panels, but users cannot control which dashboard is active and the current default-selection behavior depends on backend response order. `HEL-8` needs a real selection flow plus an explicit recency signal so the frontend can auto-select the most recently updated dashboard in a predictable, reusable way.

## What Changes

- Add a shared `meta` object to dashboard and panel resources containing `createdBy`, `createdAt`, and `lastUpdated`.
- Update backend domain models, API responses, and JSON Schemas so dashboard and panel payloads expose the shared metadata shape.
- Update frontend domain/API types to consume the shared metadata model.
- Add a left-side clickable dashboard selection list in the frontend.
- Auto-select the dashboard with the newest `meta.lastUpdated` value by default.
- Keep panel loading lazy so panel fetches only occur when the selected dashboard changes.
- Add or update tests to cover metadata-backed selection behavior and the clickable list flow.

## Capabilities

### New Capabilities
- `resource-metadata`: Provide a shared metadata shape for dashboard and panel resources.
- `frontend-dashboard-selection-flow`: Allow users to select dashboards from the frontend while defaulting to the most recently updated dashboard.

### Modified Capabilities
- `frontend-backend-read-flow`: Use explicit dashboard metadata rather than response order for the default dashboard selection.

## Impact

- `backend/src/main/scala/com/helio/domain/**`
- `backend/src/main/scala/com/helio/api/**`
- `backend/src/test/scala/com/helio/api/**`
- `frontend/src/app/**`
- `frontend/src/components/**`
- `frontend/src/features/**`
- `frontend/src/types/**`
- `schemas/*.json`
