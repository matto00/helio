## ADDED Requirements

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

#### Scenario: PaginatedQueryResult schema validates a valid response
- **WHEN** a response object `{ rows: [{col: "val"}], columns: ["col"], page: 0, pageSize: 50, hasMore: true }`
  is validated against the schema
- **THEN** validation passes

#### Scenario: PaginatedQueryResult schema rejects missing hasMore
- **WHEN** a response object omits the `hasMore` field
- **THEN** validation fails

### Requirement: Frontend Redux state tracks pagination per panel
The `panelsSlice` SHALL maintain a `paginationState` map keyed by `panelId` containing
`{ currentPage: number, hasMore: boolean, isLoadingMore: boolean, rows: Row[] }`.
A `fetchPanelPage` async thunk SHALL call `GET /api/panels/:id/execute` with the given page and
append rows to the existing state. A `resetPanelPagination` action SHALL clear pagination state for
a given panelId.

#### Scenario: Initial fetch populates rows and sets hasMore
- **WHEN** `fetchPanelPage({ panelId, page: 0, pageSize: 50 })` is dispatched and the API returns
  `{ rows: [...50 rows...], hasMore: true }`
- **THEN** `paginationState[panelId].rows` has 50 entries and `hasMore` is true

#### Scenario: Load-more appends rows
- **WHEN** `fetchPanelPage({ panelId, page: 1, pageSize: 50 })` is dispatched after page 0 is loaded
- **THEN** `paginationState[panelId].rows` has 100 entries total

#### Scenario: resetPanelPagination clears state
- **WHEN** `resetPanelPagination(panelId)` is dispatched
- **THEN** `paginationState[panelId]` is removed from state

### Requirement: Table panel displays paginated rows with a load-more button
The table panel component SHALL render rows from `paginationState[panelId].rows` when pagination
state is present. A "Load more" button SHALL be displayed when `hasMore` is true. Clicking the button
SHALL dispatch `fetchPanelPage` for the next page. While `isLoadingMore` is true, the button SHALL
show a loading indicator and be disabled.

#### Scenario: Load more button appears when hasMore is true
- **WHEN** a table panel has `hasMore: true` in its pagination state
- **THEN** a "Load more" button is visible below the table rows

#### Scenario: Load more button is absent when hasMore is false
- **WHEN** a table panel has `hasMore: false` in its pagination state
- **THEN** no "Load more" button is rendered

#### Scenario: Load more button is disabled while loading
- **WHEN** `isLoadingMore` is true for the panel
- **THEN** the button is disabled and shows a loading indicator

#### Scenario: Metric and chart panels are unaffected
- **WHEN** a metric or chart panel is rendered
- **THEN** no pagination state is fetched or displayed; the existing preview endpoint is used
