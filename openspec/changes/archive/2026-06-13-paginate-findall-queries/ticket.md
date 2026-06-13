# HEL-133 — Add pagination to unbounded findAll repository queries

## Title
Add pagination to unbounded findAll repository queries

## Description
All list queries load every row for a user with no LIMIT, which will cause memory and latency issues as data grows.

## Affected Queries

* `DashboardRepository.findAll` — loads all dashboards for a user
* `DataSourceRepository.findAll` — loads all data sources for a user
* `DataTypeRepository.findAll` — loads all data types for a user
* `PanelRepository.findByDashboardId` — loads all panels for a dashboard

## Tasks

* Define a `Page(offset: Int, limit: Int)` value type (or reuse an existing pagination model)
* Add `.drop(page.offset).take(page.limit)` to each Slick query
* Update route handlers to accept optional `?page=` / `?limit=` query params (with sensible defaults, e.g. limit=100)
* Update API response to include total count alongside results so the frontend can render pagination controls when needed

## Notes

* Panels per dashboard are naturally bounded in practice (unlikely to exceed 50–100), so `findByDashboardId` is lower priority than the top-level list queries
* Keep defaults generous (limit=200) so existing UI behaviour is unchanged initially

## Acceptance Criteria

1. A `Page(offset: Int, limit: Int)` model exists (or equivalent)
2. All four affected repository methods accept a `Page` parameter and apply `.drop(offset).take(limit)` in the Slick query
3. Route handlers for `/api/dashboards`, `/api/data-sources`, `/api/data-types` accept optional `?offset=` and `?limit=` query params (defaulting to offset=0, limit=200)
4. API responses for these list endpoints wrap results in `{ items: [...], total: <count>, offset: <n>, limit: <n> }` (or equivalent envelope)
5. `PanelRepository.findByDashboardId` also gets pagination support (lower priority but included)
6. Existing UI behaviour is unchanged (default limit=200 keeps all data loading as before)
7. Backend tests cover: default pagination, custom offset/limit, total count accuracy
