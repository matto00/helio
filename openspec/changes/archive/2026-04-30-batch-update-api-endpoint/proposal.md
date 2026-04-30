## Why

Dashboard editing sessions generate 19–39 individual write calls per session. Layout PATCHes dominate in
heavy sessions, each carrying the full 4-breakpoint layout for all panels. A batch endpoint coalesces
multiple mutations into a single round-trip, reducing network chatter and enabling atomic multi-operation
writes that are impossible with the current one-endpoint-per-concern model.

## What Changes

- **New**: `POST /api/dashboards/:id/batch` accepts an array of typed, versioned operation objects
  and applies them within a single database transaction (all-or-nothing)
- **New**: Operation types: `panelLayout`, `panelAppearance`, `dashboardAppearance`, `userPreference`
- **New**: Response includes the updated panel list so callers can eliminate the GET refetch that follows
  panel create/duplicate
- **Modified**: Frontend layout persistence path switches from `PATCH /api/dashboards/:id` (layout field)
  to `POST /api/dashboards/:id/batch` with `panelLayout` operations
- OpenAPI spec updated with batch endpoint, operation union schema, and response shape

## Capabilities

### New Capabilities

- `batch-write-api`: Transactional multi-operation write endpoint with versioned operation schema and
  enriched response (updated panel list)

### Modified Capabilities

- `frontend-layout-persistence`: Layout save path changes from direct PATCH to the batch endpoint;
  debounce logic and in-flight guard are preserved but now target `/batch`

## Impact

- **Backend**: new route in `ApiRoutes.scala`, new `BatchRepository`/service, new domain models for
  operation union types, new Flyway migration if a `user_preferences` table is needed, updated
  `JsonProtocols.scala`
- **Frontend**: `dashboardService.ts` gains `batchUpdate`; `dashboardsSlice.ts` thunk wires up the
  new call; `PanelGrid.tsx` debounce target updated
- **Schemas**: new `batch-request.json` and `batch-response.json` JSON Schema files
- **OpenAPI spec**: new path entry for `/api/dashboards/{id}/batch`

## Non-goals

- Migrating panel create or dashboard create/duplicate to the batch endpoint (those remain individual
  POST calls; the panel-list in the batch response eliminates the follow-up GET refetch)
- Client-side batching/queuing infrastructure (frontend calls batch immediately, same as current PATCH)
- Rate limiting or request size caps (out of scope for this ticket)
