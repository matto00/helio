## Why

All four list repository methods (`DashboardRepository.findAll`, `DataSourceRepository.findAll`,
`DataTypeRepository.findAll`, `PanelRepository.findByDashboardId`) issue unbounded SQL queries
with no LIMIT, causing memory and latency degradation as user data grows. Adding server-side
pagination now prevents this class of failure before it reaches production.

## What Changes

- A shared `Page(offset: Int, limit: Int)` value type is introduced in the backend domain package.
- Each affected repository method gains a `Page` parameter and applies `.drop(offset).take(limit)` in Slick.
- Each affected repository gains a companion `count(...)` method returning `Future[Int]` for total row count.
- A `PagedResult[A](items: Vector[A], total: Int, offset: Int, limit: Int)` envelope type is introduced.
- Route handlers for `GET /api/dashboards`, `GET /api/data-types`, `GET /api/data-sources`, and
  `GET /api/dashboards/:id/panels` accept optional `?offset=` and `?limit=` query params (defaults:
  offset=0, limit=200) and return a `PagedResult` envelope.
- The `JsonProtocols` object gains formatters for `Page`, `PagedResult[Dashboard]`,
  `PagedResult[DataType]`, `PagedResult[DataSource]`, and `PagedResult[Panel]`.
- The frontend service layer (`dashboardsService`, `dataSourcesService`, `dataTypesService`, `panelService`)
  TypeScript response interfaces are widened to include `total`, `offset`, `limit` alongside the existing
  `items` array — all four services already call `response.data.items`, so no unwrapping change is needed.

## Capabilities

### New Capabilities
- `list-pagination`: Shared `Page` / `PagedResult` domain model and pagination behaviour for all
  list endpoints; route param extraction and default handling.

### Modified Capabilities
- `backend-persistence`: Repository `findAll` / `findByDashboardId` signatures now accept a `Page`
  parameter and each has a new `count` companion method.
- `data-source-persistence`: `DataSourceRepository.findAll` signature changes; response shape gains
  `total`, `offset`, `limit` alongside `items`.
- `data-type-persistence`: `DataTypeRepository.findAll` signature changes; response shape gains
  `total`, `offset`, `limit` alongside `items`.

## Impact

- **Backend**: `DashboardRepository`, `DataSourceRepository`, `DataTypeRepository`, `PanelRepository`,
  `ApiRoutes`, `JsonProtocols`, domain model package (new `Page` + `PagedResult` case classes).
- **Frontend**: Service layer axios calls must unwrap `.items` from the new envelope. Redux thunks
  that currently assign the array directly need updating. No UI pagination controls are added in this
  change — that is a follow-on task.
- **API contract**: All four list responses already return `{"items": [...]}`. This change adds
  `"total"`, `"offset"`, and `"limit"` keys alongside the existing `"items"`. This is a
  non-breaking additive change (existing consumers ignore unknown fields).
- **Tests**: New backend unit/integration tests for pagination params, count accuracy, and default behaviour.

## Non-goals

- Frontend pagination UI controls (page numbers, next/prev buttons) — follow-on.
- Cursor-based pagination — offset/limit is sufficient for the current scale.
- Sorting parameters — not requested in this ticket.
