# HEL-155 — Design and implement batch update API endpoint

## Description

Backend: single endpoint (e.g. POST /api/dashboards/:id/batch) that accepts an array of typed operations (panel update, layout update, user preference update) and applies them transactionally. Update OpenAPI spec.

## Audit findings (HEL-154)

11 distinct write paths catalogued across a normal dashboard session:

| Area      | Paths                                                          |
| --------- | -------------------------------------------------------------- |
| Dashboard | Layout update, appearance, rename, create, duplicate, import   |
| Panel     | Title rename, appearance, data binding, create, duplicate      |

**Layout PATCHes** are the dominant call type. Each call sends the full 4-breakpoint layout for all panels — payload grows linearly with panel count. Currently debounced at 250ms in `PanelGrid.tsx`, coalescing drag/resize events into one call per stop.

**Panel create/duplicate** each result in 2 HTTP calls: the POST plus an immediate `GET /api/dashboards/:id/panels` refetch.

**Session volume estimates:**

* Moderate session (~5 panels, typical editing): ~19 write calls
* Heavy session (frequent repositioning): ~39 write calls

## Operation types the batch endpoint must cover

1. Panel layout update (dominant — full 4-breakpoint layout array)
2. Panel appearance update (title, type, color, etc.)
3. Dashboard appearance update (name, accent color, etc.)
4. User preference update (zoom level — per-user per-dashboard)

## Design notes

* The panel refetch after create/duplicate can be eliminated if the batch endpoint returns the updated panel list in its response
* Payload schema should version operation types to allow future extension
* All operations in a batch should apply transactionally (all-or-nothing)

## Acceptance Criteria

1. `POST /api/dashboards/:id/batch` endpoint exists and is documented in the OpenAPI spec
2. Endpoint accepts an array of typed operations covering all four operation types listed above
3. All operations within a batch apply transactionally (all succeed or all fail)
4. Endpoint returns sufficient data in the response to eliminate the panel refetch after create/duplicate
5. Payload schema versions operation types for future extensibility
6. Backend tests cover: happy path, partial-failure rollback, and unknown operation type handling
7. Frontend is updated to use the batch endpoint for layout updates (replacing the existing PATCH /api/dashboards/:id layout path)
