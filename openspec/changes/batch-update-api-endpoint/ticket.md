# HEL-155 — Design and implement batch update API endpoint (Redesign)

## Description

Replace the previous `POST /api/dashboards/:id/batch` typed-ops envelope with a cleaner,
resource-oriented set of three endpoints.

## New API Design

| Endpoint | Purpose |
|----------|---------|
| `PATCH /api/dashboards/:id/update` | Update dashboard fields (appearance, name, etc.) |
| `POST /api/panels/updateBatch` | Update multiple panels in one call (layout, appearance, or any fields) |
| `PATCH /api/users/:id/update` | Update user preferences (zoom level, etc.) |

### Payload shapes

**PATCH /api/dashboards/:id/update**
```json
{ "fields": ["name", "accentColor"], "dashboard": { "name": "My Dashboard", "accentColor": "#ff0000" } }
```

**POST /api/panels/updateBatch**
```json
{ "fields": ["layout"], "panels": [{ "id": "...", "layout": [...] }, ...] }
```

**PATCH /api/users/:id/update**
```json
{ "fields": ["zoomLevel"], "user": { "zoomLevel": 1.2 } }
```

## Key Design Points

- The `panelLayout` vs `panelAppearance` split from the previous design is eliminated — `panels/updateBatch` accepts any panel fields present in the payload
- `dashboards/update` and `users/update` are singular-resource updates (no batching needed)
- The frontend flush calls the appropriate endpoint(s) depending on what changed; calling 2 endpoints is acceptable since dashboard and user preference resources never change simultaneously with panel layout
- The `userPreference` op remains a noop on the backend for now (no `user_preferences` table yet) — `users/update` should be scaffolded the same way, returning 200 OK immediately
- `openapi.yaml` has already been removed from the branch — no comprehensive OpenAPI spec file exists yet
- The `notes/roadmap-v2.md` Prettier fix already on the branch should be kept
- Update `schemas/batch-request.schema.json` and `schemas/batch-response.schema.json` to reflect the new shapes (or replace with per-endpoint schemas if cleaner)
- Update `PanelGrid.tsx` to dispatch to `panels/updateBatch` instead of the old batch endpoint

## Previous Implementation (to be replaced)

The branch currently has an implementation of `POST /api/dashboards/:id/batch` with typed ops.
All of that backend route, service layer, and frontend code should be removed and replaced with the
new resource-oriented endpoints.

Files from the old implementation that need updating/replacement:
- `frontend/src/components/PanelGrid.tsx` — currently calls old batch endpoint
- `frontend/src/features/dashboards/dashboardsSlice.ts` — has `batchUpdate` thunk
- `frontend/src/services/dashboardService.ts` — has `batchUpdate` service call
- `frontend/src/types/models.ts` — has old batch op type definitions
- `backend/.../routes/DashboardRoutes.scala` — has old batch route
- `backend/.../infrastructure/DashboardRepository.scala` — has old batch logic
- `backend/.../api/JsonProtocols.scala` — has old batch JSON codecs
- `backend/.../api/ApiRoutesSpec.scala` — has old batch tests
- `schemas/batch-request.schema.json` — old envelope schema
- `schemas/batch-response.schema.json` — old envelope response schema

## Acceptance Criteria

1. `PATCH /api/dashboards/:id/update` exists; accepts `{ fields, dashboard }` and updates only the listed fields
2. `POST /api/panels/updateBatch` exists; accepts `{ fields, panels: [{id, ...}] }` and updates all listed panels
3. `PATCH /api/users/:id/update` exists; accepts `{ fields, user }` and returns 200 OK (noop — no DB table yet)
4. All old batch endpoint code removed from backend, frontend, and schemas
5. `PanelGrid.tsx` layout flush dispatches to `panels/updateBatch` (or `dashboards/update` for dashboard-level fields)
6. Schemas updated to reflect new endpoint shapes
7. Backend tests cover happy path for each new endpoint; panel batch covers multiple panels in one call
8. Frontend tests cover the new thunks
