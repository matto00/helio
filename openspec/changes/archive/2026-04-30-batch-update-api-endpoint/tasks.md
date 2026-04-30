## 1. Backend

- [x] 1.1 Add `BatchOperation` sealed trait and `BatchRequest`/`BatchResponse` case classes to `JsonProtocols.scala`
- [x] 1.2 Add Spray JSON formatters for all batch request/response types in `JsonProtocols.scala`
- [x] 1.3 Add `batchUpdate` method to `DashboardRepository` using `DBIO.seq(...).transactionally`
- [x] 1.4 Add `POST /api/dashboards/:id/batch` route to `DashboardRoutes.scala`
- [x] 1.5 Add validation logic for batch request: reject empty ops array and unknown op values

## 2. Schemas

- [x] 2.1 Add `schemas/batch-request.schema.json` with `ops` array and versioned operation union
- [x] 2.2 Add `schemas/batch-response.schema.json` with `dashboard` and `panels` fields

## 3. OpenAPI

- [x] 3.1 Add `POST /api/dashboards/{id}/batch` path entry to the OpenAPI spec with request/response schema refs

## 4. Frontend

- [x] 4.1 Add `batchUpdate(dashboardId, ops)` function to `dashboardService.ts`
- [x] 4.2 Add `saveDashboardBatch` thunk to `dashboardsSlice.ts` that calls `batchUpdate`
- [x] 4.3 Update `PanelGrid.tsx` debounce handler to dispatch `saveDashboardBatch` with a `panelLayout` op instead of the existing layout PATCH thunk

## 5. Tests

- [x] 5.1 Backend: happy path — batch with `panelLayout` + `dashboardAppearance` ops applies both and returns updated state
- [x] 5.2 Backend: rollback — batch with a valid op followed by an op referencing a non-existent panel rolls back all changes
- [x] 5.3 Backend: unknown op — batch containing an unrecognized `op` value returns `400`
- [x] 5.4 Backend: empty ops array returns `400`
- [x] 5.5 Frontend: `saveDashboardBatch` thunk dispatches the correct action and updates Redux state on success
