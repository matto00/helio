# panel-query-pagination Specification

## Purpose
Defines server-side pagination for panel query execution results and the load-more UX for table panels.

## API

### GET /api/panels/{id}/execute

Execute a bound panel's query against its backing SQL data source and return a paginated result page.

**Authentication**: Required

**Path Parameters**

| Name | Type   | Description   |
|------|--------|---------------|
| id   | string | Panel ID (UUID) |

**Query Parameters**

| Name     | Type    | Default | Description                               |
|----------|---------|---------|-------------------------------------------|
| page     | integer | 0       | 0-indexed page number. Must be >= 0.      |
| pageSize | integer | 50      | Rows per page. Must be between 1 and 500. |

**Responses**

| Status | Description                                      |
|--------|--------------------------------------------------|
| 200    | Paginated result envelope (`PaginatedQueryResult`) |
| 400    | Invalid `page` or `pageSize` parameter           |
| 404    | Panel not found or panel is not bound to a data type |
| 500    | Query execution failed                           |

**200 Response Schema** (`PaginatedQueryResult`):

```json
{
  "rows": [{ "column_name": "value" }],
  "columns": ["column_name"],
  "page": 0,
  "pageSize": 50,
  "hasMore": true
}
```

See `schemas/paginated-query-result.schema.json` for the full JSON Schema 2020-12 definition.

**400 Response Schema** (`ErrorResponse`):

```json
{ "message": "pageSize must be between 1 and 500" }
```

**Notes**

- Only SQL data sources (`sourceType: "sql"`) are supported. Other source types return 400.
- Pagination is implemented via `SELECT * FROM (<original_query>) AS _paged LIMIT <pageSize+1> OFFSET <page*pageSize>`. Fetching `pageSize+1` rows allows the backend to compute `hasMore` without a separate COUNT query.
- The endpoint is additive — existing preview endpoints (`/api/data-sources/:id/preview`) are unchanged.
- Metric and chart panels use existing preview endpoints and are unaffected by this feature.

## Requirements

### Requirement: GET /api/panels/:id/execute returns a paginated query result
The backend SHALL expose `GET /api/panels/:id/execute` that executes the panel's `PanelQuery` against
its backing data source and returns a paginated result envelope. The endpoint SHALL accept optional
query parameters `page` (0-indexed integer, default 0) and `pageSize` (integer 1–500, default 50).
The response body SHALL be a `PaginatedQueryResult` JSON object with fields: `rows` (array of
column-name → value objects), `columns` (ordered array of column name strings), `page` (integer),
`pageSize` (integer), and `hasMore` (boolean). The endpoint SHALL require authentication and apply
panel ACL checks consistent with other panel sub-routes.

#### Scenario: Table panel executes first page successfully
- **WHEN** `GET /api/panels/:id/execute` is called with `?page=0&pageSize=50` for a bound table panel
  whose DataType has a SQL-backed DataSource
- **THEN** the response is `200 OK` with a `PaginatedQueryResult` where `rows` contains up to 50
  entries, `page` is 0, `pageSize` is 50, and `hasMore` is true if more rows exist

#### Scenario: Last page sets hasMore to false
- **WHEN** `GET /api/panels/:id/execute` is called with `?page=2&pageSize=50` and the total rows are
  fewer than 151
- **THEN** the response is `200 OK` with `hasMore: false`

#### Scenario: Unbound panel returns 404
- **WHEN** `GET /api/panels/:id/execute` is called for a panel with `typeId: null`
- **THEN** the response is `404 Not Found`

#### Scenario: Non-existent panel returns 404
- **WHEN** `GET /api/panels/:id/execute` is called for a panel ID that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: pageSize exceeding maximum is rejected
- **WHEN** `GET /api/panels/:id/execute` is called with `?pageSize=501`
- **THEN** the response is `400 Bad Request`

#### Scenario: Negative page number is rejected
- **WHEN** `GET /api/panels/:id/execute` is called with `?page=-1`
- **THEN** the response is `400 Bad Request`

### Requirement: PaginatedQueryResult is defined in JSON schema and OpenAPI spec
The system SHALL define a `PaginatedQueryResult` JSON schema with properties: `rows` (array of
objects), `columns` (array of strings), `page` (integer, minimum 0), `pageSize` (integer, minimum 1,
maximum 500), and `hasMore` (boolean). A corresponding OpenAPI path entry SHALL document the
`GET /api/panels/{id}/execute` operation.

### Requirement: Frontend Redux state tracks pagination per panel
The `panelsSlice` SHALL maintain a `paginationState` map keyed by `panelId` containing
`{ currentPage: number, hasMore: boolean, isLoadingMore: boolean, rows: Row[] }`.
A `fetchPanelPage` async thunk SHALL call `GET /api/panels/:id/execute` with the given page and
append rows to the existing state. A `resetPanelPagination` action SHALL clear pagination state for
a given panelId.

### Requirement: Table panel displays paginated rows with a load-more button
The table panel component SHALL render rows from `paginationState[panelId].rows` when pagination
state is present. A "Load more" button SHALL be displayed when `hasMore` is true. Clicking the button
SHALL dispatch `fetchPanelPage` for the next page. While `isLoadingMore` is true, the button SHALL
show a loading indicator and be disabled.
