## MODIFIED Requirements

### Requirement: DataSourceRepository provides async CRUD
The `DataSourceRepository` class SHALL expose
`findAll(ownerId: UserId, page: Page): Future[PagedResult[DataSource]]`,
`findById(id): Future[Option[DataSource]]`, `insert(source): Future[DataSource]`,
`update(source): Future[Option[DataSource]]`, and `delete(id): Future[Boolean]`, all returning `Future`.
The paginated `findAll` SHALL compose both the count query and slice query into a single DBIO action
so both execute in the same `withUserContext` session.

#### Scenario: Insert returns the inserted entity
- **WHEN** `insert` is called with a valid `DataSource`
- **THEN** the returned `DataSource` equals the input

#### Scenario: Update returns the updated entity
- **WHEN** `update` is called with a modified `DataSource` for an existing id
- **THEN** the returned `Option[DataSource]` is `Some` with the updated values and a refreshed `updatedAt`

#### Scenario: Update returns None for unknown id
- **WHEN** `update` is called with an id that does not exist
- **THEN** the return value is `None`

#### Scenario: findAll with page returns correct PagedResult
- **WHEN** `findAll(ownerId, Page(offset=0, limit=5))` is called and 10 sources exist for that owner
- **THEN** the returned `PagedResult` has `items.size == 5` and `total == 10`

### Requirement: GET /api/data-sources lists all data sources for the authenticated user
The API SHALL expose `GET /api/data-sources` returning only the requesting user's data sources
as `{"items": [...], "total": N, "offset": 0, "limit": 200}` (with optional `?offset=` and
`?limit=` query params, defaulting to offset=0, limit=200).

#### Scenario: Empty list is returned when user has no sources
- **WHEN** `GET /api/data-sources` is called with no sources registered for that user
- **THEN** the response is 200 with `{"items": [], "total": 0, "offset": 0, "limit": 200}`

#### Scenario: Only the owner's sources are returned
- **WHEN** multiple users have created data sources
- **THEN** `GET /api/data-sources` returns only the requesting user's sources in the `items` array
