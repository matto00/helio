## Why

Spark queries over large datasets can return millions of rows. Without pagination, the backend would
attempt to hold the full result set in memory and the frontend would render an unusably large table.
This work introduces server-side paging so table panels can load results incrementally.

## What Changes

- Backend `GET /api/panels/:id/execute` (introduced by HEL-206) gains `page` and `pageSize` query
  parameters and returns a paginated envelope: `{ rows, page, pageSize, hasMore }`.
- Table panel type adds a "Load more" button that dispatches subsequent page fetches and appends rows.
- Metric and chart panels continue to receive pre-aggregated / limited results from their existing
  preview endpoints — they are unaffected by this change.
- Redux state in `panelsSlice` tracks `{ currentPage, hasMore, isLoadingMore }` per panel.
- JSON schema and OpenAPI spec are updated to reflect the paginated response envelope.

## Capabilities

### New Capabilities

- `panel-query-pagination`: Server-side pagination for panel query execution results; load-more UX for
  table panels; Redux pagination state management.

### Modified Capabilities

- `panel-bound-data-fetch`: Table panels now use `GET /api/panels/:id/execute` with pagination
  parameters rather than the CSV preview endpoint for large Spark-backed sources.

## Impact

- Backend: `PanelQueryRoutes` (HEL-206), `PanelQueryExecutor`, response model types,
  `JsonProtocols`.
- Frontend: `panelsSlice`, table panel component, panel query service.
- Schemas: new `PaginatedQueryResult` schema; OpenAPI spec update for execute endpoint.
- No changes to metric or chart panel code paths.

## Non-goals

- Virtual/infinite scroll (load-more button is sufficient for v1).
- Cursor-based pagination (offset/page-number is acceptable given Spark job re-execution cost).
- Pagination for chart or metric panels.
