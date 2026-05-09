## Context

HEL-206 (panel-query-executor) introduced `GET /api/panels/:id/query` which returns the structured
`PanelQuery` for a bound panel. The actual execution of that query against Spark/SQL data sources has
not yet been exposed as an HTTP endpoint. Table panels currently use CSV preview endpoints
(`/api/data-sources/:id/preview`) for displaying data, which are limited to 10–200 rows and not
paginated. For large Spark-backed result sets this is insufficient.

The `SparkJobSubmitter` (used by pipelines) already shows the pattern for async Spark execution.
`SqlConnector.execute` provides synchronous SQL query execution used in SourceRoutes. For panel
query execution we need a synchronous, paginated endpoint backed by the simplest available
data source (SQL connector for SQL sources, CSV for CSV sources).

## Goals / Non-Goals

**Goals:**
- New `GET /api/panels/:id/execute` endpoint with `?page=<n>&pageSize=<n>` query params.
- Returns `PaginatedQueryResult` envelope: `{ rows, columns, page, pageSize, hasMore }`.
- Table panel frontend adds "Load more" button that appends rows from subsequent pages.
- Redux slice tracks `{ currentPage, hasMore, isLoadingMore }` per panel (keyed by panelId).
- JSON schema `PaginatedQueryResult` is added; OpenAPI spec updated.

**Non-Goals:**
- Async/Spark job-based execution for panel queries (sync SQL/CSV execution only in v1).
- Cursor-based pagination.
- Pagination for chart or metric panel types.
- Virtual scrolling.

## Decisions

**D1: Offset/page-number pagination over cursor-based**
Re-executing the Spark or SQL query per page-turn is acceptable because panel previews are
small-scale. Cursor-based pagination would require server-side state between requests. Offset/page is
simpler and sufficient for v1.

**D2: Synchronous execution via SqlConnector for SQL sources**
`SqlConnector.execute` already handles SQL data sources synchronously. For the panel execute endpoint
we call it with `OFFSET page*pageSize LIMIT pageSize+1` to detect `hasMore`. This avoids the full
Spark job overhead for interactive pagination.

**D3: New `PanelExecuteRoutes` class rather than extending `PanelRoutes`**
`PanelRoutes.scala` is already 350+ lines. A dedicated `PanelExecuteRoutes` is consistent with the
project pattern (each concern in its own routes file) and keeps `ApiRoutes.scala` composable.
`PanelExecuteRoutes` is wired into `ApiRoutes` alongside the existing panel routes.

**D4: Frontend state keyed by panelId in panelsSlice**
Pagination state (`currentPage`, `hasMore`, `isLoadingMore`, `executionRows`) lives in
`panelsSlice` as a `Record<string, PanelPaginationState>`. This follows the existing pattern where
panel data is keyed by panelId. A `resetPanelPagination` action clears state on panel unmount.

**D5: Default pageSize = 50**
50 rows balances latency and useful data density for a dashboard table panel. Clients may override
with `?pageSize=<n>` (max 500 enforced by backend).

## Risks / Trade-offs

- Re-executing the full query per page turn is wasteful for large data sets.
  → Mitigation: caching is deferred to a follow-up ticket; pageSize cap (500) limits individual response size.
- `OFFSET`-based pagination can be slow on large tables.
  → Acceptable for v1; the result set for dashboard panels is expected to be in the thousands of rows, not millions.
- SQL injection via panel fieldMapping fields.
  → `SqlConnector` uses parameterized queries; `selectedFields` are validated as column names before use.

## Migration Plan

No data migration required. The new endpoint is additive. Existing preview endpoints are unchanged.
Deploy backend first, then frontend — the load-more button is only shown when the execute endpoint
is used, which is opt-in from the frontend.

## Planner Notes

Self-approved: additive endpoint, no breaking changes, follows established project patterns.
No new external dependencies (uses existing `SqlConnector` and `SparkJobSubmitter` infrastructure).
