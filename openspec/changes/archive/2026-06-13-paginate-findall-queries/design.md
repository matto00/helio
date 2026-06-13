## Context

All four list queries (`DashboardRepository.findAll`, `DataSourceRepository.findAll`,
`DataTypeRepository.findAll`, `PanelRepository.findAllByDashboardId`) issue unbounded SQL SELECT
with no LIMIT clause. Each repository already follows a consistent pattern: `table.filter(predicate).sortBy(...).result`.
Slick provides `.drop(n).take(m)` composable operators that map directly to SQL OFFSET/LIMIT.
A companion count query uses `table.filter(predicate).length.result`.

The `GET /api/dashboards/:id/panels` endpoint is handled by `PublicDashboardRoutes`, which calls
`PanelRepository.findAllByDashboardId` directly (no service intermediary). The other three list
endpoints (`GET /api/dashboards`, `GET /api/types`, `GET /api/data-sources`) each go through a
thin route class that delegates to a service.

## Goals / Non-Goals

**Goals:**
- Add `Page(offset, limit)` value type to the domain package (`com.helio.domain`)
- Add `PagedResult[A](items, total, offset, limit)` response envelope to the domain package
- Update each of the four repositories with a paginated findAll/findAllByDashboardId plus a count query
- Update route handlers to extract optional `offset`/`limit` query params with defaults offset=0, limit=200
- Update `JsonProtocols` with formatters for `Page`, `PagedResult[Dashboard]`, `PagedResult[Panel]`,
  `PagedResult[DataType]`, `PagedResult[DataSource]`
- Update the four GET list routes to return `PagedResult` envelope
- Add backend tests for pagination behaviour
- Update frontend service TypeScript response interfaces to include `total`, `offset`, `limit` fields (all four services already call `response.data.items`; this is a type-widening step only)

**Non-Goals:**
- Frontend pagination UI controls
- Cursor-based or keyset pagination
- Sorting parameters

## Decisions

**D1: Where to define Page and PagedResult — `com.helio.domain` package**
The domain package (`domain/model.scala` or a new `domain/pagination.scala`) already holds all value
types (`DashboardId`, `UserId`, etc.) and is imported by all layers. Placing `Page` there avoids
a circular dependency with `api` or `infrastructure`. Alternative (define in `api` package) was
rejected because repositories would need to import from `api`, inverting the dependency direction.

**D2: Count + data queries composed as a single DBIO action inside the repository**
Each paginated repository method (`findAll`, `findAllByDashboardId`) assembles both the count
query (`table.filter(p).length.result`) and the slice query
(`table.filter(p).drop(offset).take(limit).sortBy(...).result`) into a single `DBIO` action
using `DBIO.sequence` or explicit `for`/`flatMap` composition. The single action is run inside
one `withUserContext` call so both queries share the same RLS session. The repository method
returns `Future[PagedResult[A]]` directly — callers (service layer) receive the assembled
result and do not call a separate `countAll` method. Separate `countAll` public methods are
**not added** (they would require two `withUserContext` calls and introduce a TOCTOU gap).

**D3: Default limit=200, default offset=0**
Keeps existing UI behaviour unchanged (all data loads in one page). The ticket explicitly states
"keep defaults generous (limit=200)". A cap of 500 is imposed server-side to prevent a caller
from bypassing pagination with limit=99999.

**D4: Response envelope `{"items":[...], "total": N, "offset": 0, "limit": 200}`**
All four list endpoints already return `{"items":[...]}` (confirmed: `DashboardsResponse`,
`DataTypesResponse`, `DataSourcesResponse`, and `PanelsResponse` all carry an `items` field;
the frontend service functions all call `response.data.items`). This change is purely **additive**:
appending `total`, `offset`, and `limit` alongside the existing `items` key. The existing `items`
consumers are unaffected; the new fields are ignored until consumed. Unknown fields are not
serialized by existing frontend callers, making the server-side addition non-breaking.

**D5: Panels route is on `GET /api/dashboards/:id/panels` via `PublicDashboardRoutes`**
This endpoint is handled by `PublicDashboardRoutes` (not `DashboardRoutes` or `DashboardService`).
`PublicDashboardRoutes` calls `PanelRepository.findAllByDashboardId` directly. Pagination params
are added to the `PublicDashboardRoutes` `GET /dashboards/:id/panels` handler, and a companion
`countByDashboardId` method is added to `PanelRepository`.

**D6: Frontend update scope**
All four service functions already unwrap `.items` from the response:
- `dashboardService.ts`: `return response.data.items`
- `dataSourceService.ts`: `return response.data.items`
- `dataTypeService.ts`: `return response.data.items`
- `panelService.ts`: `return response.data.items`
The actual frontend work is **type-widening**: updating the TypeScript response interfaces to include
`total: number; offset: number; limit: number` so the compiler enforces consistency. No Redux state
changes are needed unless the caller stores pagination metadata — they do not currently. This avoids
any visual regression.

## Risks / Trade-offs

[Risk: Parallel count + data queries increase DB load per list call]
→ Mitigation: Both queries are on the same indexed `owner_id` column (indexes exist per V17 migration).
  At the current scale (hundreds of rows per user) this is negligible.

[Risk: Frontend TypeScript callers miss new response fields and pass incomplete types to Redux]
→ Mitigation: Widening the TypeScript response interface causes a compiler error at any call site
  that destructures or assigns the response to a narrower type. All four service files are updated
  together so the compiler catches any missed call-sites.

## Planner Notes

Self-approved: This change touches repository, service, route, JSON, and frontend layers but follows
a mechanical pattern — no new external dependencies, no migration, no breaking auth surface.
The sole judgment call (D6: frontend scope) keeps changes safe and backward-compatible.
