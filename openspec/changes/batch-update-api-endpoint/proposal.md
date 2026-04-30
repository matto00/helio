## Why

The previous batch-endpoint design used a single `POST /api/dashboards/:id/batch` typed-ops envelope
that mixed panel layout, panel appearance, dashboard appearance, and user preferences into one call.
The new resource-oriented design replaces this with three focused endpoints that align with REST
resource boundaries and eliminate the dashboard-id coupling from panel mutations.

## What Changes

- **Remove** `POST /api/dashboards/:id/batch` endpoint and all associated backend/frontend code
- **Add** `PATCH /api/dashboards/:id/update` — partial update for dashboard fields (name, appearance)
- **Add** `POST /api/panels/updateBatch` — update multiple panels in one call (layout, appearance, any fields)
- **Add** `PATCH /api/users/:id/update` — update user preferences (noop on backend for now, no DB table)
- **Update** `PanelGrid.tsx` layout flush to dispatch to `panels/updateBatch`
- **Update** schemas to reflect the three new endpoint shapes

## Capabilities

### New Capabilities
- `dashboard-partial-update`: PATCH /api/dashboards/:id/update with `{ fields, dashboard }` payload
- `panel-batch-update`: POST /api/panels/updateBatch with `{ fields, panels: [{id, ...}] }` payload
- `user-preference-update`: PATCH /api/users/:id/update scaffold (noop — no DB table yet)

### Modified Capabilities
- `frontend-layout-persistence`: layout flush now targets `POST /api/panels/updateBatch` instead of the old batch endpoint
- `dashboard-appearance-settings`: appearance save now targets `PATCH /api/dashboards/:id/update`

## Impact

- Backend: DashboardRoutes, PanelRoutes (new), UserRoutes (new), DashboardRepository, PanelRepository,
  JsonProtocols — old batch types removed, new request/response types added
- Frontend: dashboardsSlice, panelsSlice (new thunk), dashboardService, panelService, PanelGrid.tsx, models.ts
- Schemas: batch-request.schema.json and batch-response.schema.json replaced with per-endpoint schemas
  (dashboard-update-request, panel-batch-update-request, user-update-request)

## Non-goals

- Transactional all-or-nothing semantics across endpoints (each endpoint is independent)
- Eliminating the panel refetch after create/duplicate (separate ticket)
- Persisting user preferences to a `user_preferences` DB table (no table exists yet)
