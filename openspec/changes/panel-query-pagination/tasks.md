## 1. Backend

- [x] 1.1 Add `PaginatedQueryResult` case class to `model.scala` with fields: `rows`, `columns`, `page`, `pageSize`, `hasMore`
- [x] 1.2 Register `paginatedQueryResultFormat` in `JsonProtocols.scala`
- [x] 1.3 Create `PanelExecuteRoutes.scala` with `GET /panels/:id/execute` route handling `page` and `pageSize` query params
- [x] 1.4 Validate `page >= 0` and `1 <= pageSize <= 500` in the route, returning 400 on invalid params
- [x] 1.5 Return 404 when panel not found or panel is unbound
- [x] 1.6 Implement execution logic: fetch DataType + DataSource for the panel, run `SqlConnector.execute` with offset-based pagination (`OFFSET page*pageSize LIMIT pageSize+1`) and compute `hasMore`
- [x] 1.7 Wire `PanelExecuteRoutes` into `ApiRoutes.scala` under authenticated routes

## 2. Schema and Spec

- [x] 2.1 Add `PaginatedQueryResult.json` JSON schema to `schemas/`
- [x] 2.2 Add `GET /api/panels/{id}/execute` OpenAPI path entry to the relevant spec file in `openspec/specs/`

## 3. Frontend

- [x] 3.1 Add `PaginatedQueryResult` TypeScript interface to `frontend/src/types/models.ts`
- [x] 3.2 Add `fetchPanelExecutePage(panelId, page, pageSize)` function to `panelService.ts` calling `GET /api/panels/:id/execute`
- [x] 3.3 Add `paginationState` map to `panelsSlice` state: `Record<string, PanelPaginationState>` with fields `currentPage`, `hasMore`, `isLoadingMore`, `rows`
- [x] 3.4 Add `fetchPanelPage` async thunk to `panelsSlice` that calls `fetchPanelExecutePage` and appends rows on page > 0
- [x] 3.5 Add `resetPanelPagination` action to `panelsSlice`
- [x] 3.6 Update `usePanelData` hook (or equivalent) to dispatch `fetchPanelPage` on mount for `type === "table"` panels instead of the preview endpoint
- [x] 3.7 Update `PanelContent` table rendering to use `paginationState[panelId].rows` when pagination state is present
- [x] 3.8 Add "Load more" button below the table, visible when `hasMore: true`, disabled + loading when `isLoadingMore: true`

## 4. Tests

- [x] 4.1 Add `PanelExecuteRoutesSpec.scala` (embedded Postgres) covering: first-page success, last-page `hasMore: false`, unbound-panel 404, invalid params 400
- [x] 4.2 Add unit tests to `panelsSlice.test.ts` covering: `fetchPanelPage` initial load, load-more append, `resetPanelPagination` clears state
