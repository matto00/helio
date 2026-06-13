## 1. Backend — Domain Models

- [x] 1.1 Add `Page(offset: Int, limit: Int)` case class to `com.helio.domain` (model.scala or new pagination.scala)
- [x] 1.2 Add `PagedResult[A](items: Vector[A], total: Int, offset: Int, limit: Int)` case class to `com.helio.domain`

## 2. Backend — Repository Layer

- [x] 2.1 Update `DashboardRepository.findAll` signature to `findAll(ownerId: UserId, page: Page): Future[PagedResult[Dashboard]]`, composing count + slice queries in a single DBIO action via `DBIO.sequence`/`for` inside one `withUserContext` call
- [x] 2.2 Update `DataTypeRepository.findAll` signature to `findAll(ownerId: UserId, page: Page): Future[PagedResult[DataType]]`, composing count + slice in a single DBIO action
- [x] 2.3 Update `DataSourceRepository.findAll` signature to `findAll(ownerId: UserId, page: Page): Future[PagedResult[DataSource]]`, composing count + slice in a single DBIO action
- [x] 2.4 Update `PanelRepository.findAllByDashboardId` signature to accept `page: Page` and return `Future[PagedResult[Panel]]`, composing count + slice in a single DBIO action per branch (owner/grantee/empty)

## 3. Backend — Service Layer

- [x] 3.1 Update `DashboardService.findAll` to accept `Page`, delegate to `DashboardRepository.findAll(ownerId, page)`, return `PagedResult[Dashboard]`
- [x] 3.2 Update `DataTypeService.findAll` to accept `Page`, delegate to `DataTypeRepository.findAll(ownerId, page)`, return `PagedResult[DataType]`
- [x] 3.3 Update `DataSourceService.findAll` to accept `Page`, delegate to `DataSourceRepository.findAll(ownerId, page)`, return `PagedResult[DataSource]`
- [x] 3.4 Update `PublicDashboardRoutes` to build `Page` from params and call `PanelRepository.findAllByDashboardId(dashId, callerOpt, page)` returning `PagedResult[Panel]` directly (no service intermediary)

## 4. Backend — JSON Protocols

- [x] 4.1 Add `implicit jsonFormat` for `PagedResult[Dashboard]` in `JsonProtocols`
- [x] 4.2 Add `implicit jsonFormat` for `PagedResult[DataType]` in `JsonProtocols`
- [x] 4.3 Add `implicit jsonFormat` for `PagedResult[DataSource]` in `JsonProtocols`
- [x] 4.4 Add `implicit jsonFormat` for `PagedResult[Panel]` in `JsonProtocols`

## 5. Backend — Routes

- [x] 5.1 Update `DashboardRoutes GET /` to extract `offset`/`limit` params, build `Page`, return `PagedResult` response
- [x] 5.2 Update `DataTypeRoutes GET /` to extract `offset`/`limit` params, build `Page`, return `PagedResult` response
- [x] 5.3 Update `DataSourceRoutes GET /` to extract `offset`/`limit` params, build `Page`, return `PagedResult` response
- [x] 5.4 Update `PublicDashboardRoutes GET /dashboards/:id/panels` to extract `offset`/`limit` params, build `Page`, return `PagedResult[Panel]` response
- [x] 5.5 Add server-side clamping: limit is capped at 500; offset < 0 returns 400

## 6. Frontend — Service Layer (Type Widening)

- [x] 6.1 Define shared `PagedResult<T>` TypeScript interface (items, total, offset, limit) in a shared types file
- [x] 6.2 Update `dashboardService` axios response type to `PagedResult<DashboardResponse>` (already returns `.items`; widen type only)
- [x] 6.3 Update `dataTypeService` axios response type to `PagedResult<DataTypeResponse>` (already returns `.items`; widen type only)
- [x] 6.4 Update `dataSourceService` axios response type to `PagedResult<DataSourceResponse>` (already returns `.items`; widen type only)
- [x] 6.5 Update panels fetch response type to `PagedResult<PanelResponse>` (already returns `.items`; widen type only)

## 7. Tests

- [x] 7.1 Test `DashboardRepository.findAll` returns correct `PagedResult`: correct `items` slice, correct `total`, offset/limit reflected
- [x] 7.2 Test `DataTypeRepository.findAll` returns correct `PagedResult`: items slice, total, offset/limit
- [x] 7.3 Test `DataSourceRepository.findAll` returns correct `PagedResult`: items slice, total, offset/limit
- [x] 7.4 Test `PanelRepository.findAllByDashboardId` returns correct `PagedResult`: items slice, total, offset/limit
- [x] 7.5 Test route-layer default params for `GET /api/dashboards` (no params → offset=0, limit=200 in JSON response)
- [x] 7.6 Test route-layer limit capping (limit=9999 → limit field in response is 500 or clamped value)
- [x] 7.7 Test route-layer 400 for negative offset
