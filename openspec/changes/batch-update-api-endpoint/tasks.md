## 1. Backend — Remove old batch code

- [ ] 1.1 Remove `POST /api/dashboards/:id/batch` route from DashboardRoutes.scala
- [ ] 1.2 Remove batch JSON codecs from JsonProtocols.scala (BatchRequest, BatchOperation, BatchResponse types)
- [ ] 1.3 Remove `batchUpdate` method from DashboardRepository.scala
- [ ] 1.4 Remove old batch test cases from ApiRoutesSpec.scala

## 2. Backend — Add new endpoints

- [ ] 2.1 Add `PATCH /api/dashboards/:id/update` route to DashboardRoutes.scala; accepts `{ fields, dashboard }` body
- [ ] 2.2 Add `dashboardPartialUpdate` method to DashboardRepository that updates only the listed fields
- [ ] 2.3 Add `POST /api/panels/updateBatch` route (new PanelRoutes or existing); accepts `{ fields, panels: [{id,...}] }` body
- [ ] 2.4 Add `panelBatchUpdate` method to PanelRepository that iterates and updates each panel
- [ ] 2.5 Add `PATCH /api/users/:id/update` route; returns 200 OK with empty body (noop)
- [ ] 2.6 Add request/response case classes and JSON codecs for all three new endpoints

## 3. Backend — Register routes

- [ ] 3.1 Register the new dashboard /update and user /update routes in ApiRoutes.scala
- [ ] 3.2 Register the panels/updateBatch route in ApiRoutes.scala

## 4. Schemas

- [ ] 4.1 Replace schemas/batch-request.schema.json with schemas/dashboard-update-request.schema.json
- [ ] 4.2 Replace schemas/batch-response.schema.json with schemas/panel-batch-update-request.schema.json
- [ ] 4.3 Add schemas/user-update-request.schema.json

## 5. Frontend — Remove old batch code

- [ ] 5.1 Remove `batchUpdate` thunk from dashboardsSlice.ts
- [ ] 5.2 Remove `batchUpdate` function from dashboardService.ts
- [ ] 5.3 Remove old batch op type definitions from models.ts (BatchOperation, BatchRequest, BatchResponse, etc.)

## 6. Frontend — Add new thunks and services

- [ ] 6.1 Add `updateDashboard` thunk to dashboardsSlice.ts (calls PATCH /api/dashboards/:id/update)
- [ ] 6.2 Add `updateDashboard` function to dashboardService.ts
- [ ] 6.3 Add `updatePanelsBatch` thunk to panelsSlice.ts (calls POST /api/panels/updateBatch)
- [ ] 6.4 Add `updatePanelsBatch` function to panelService.ts
- [ ] 6.5 Add `updateUserPreferences` thunk/service (calls PATCH /api/users/:id/update)
- [ ] 6.6 Add new request/response types to models.ts for all three endpoints

## 7. Frontend — Wire PanelGrid

- [ ] 7.1 Update PanelGrid.tsx layout flush to dispatch `updatePanelsBatch` instead of old batch endpoint

## 8. Tests

- [ ] 8.1 Add backend test: PATCH /api/dashboards/:id/update — happy path (name update, appearance update)
- [ ] 8.2 Add backend test: POST /api/panels/updateBatch — happy path (single panel, multiple panels)
- [ ] 8.3 Add backend test: PATCH /api/users/:id/update — returns 200 OK
- [ ] 8.4 Add frontend test: updateDashboard thunk dispatches correct action on success
- [ ] 8.5 Add frontend test: updatePanelsBatch thunk dispatches correct action on success
