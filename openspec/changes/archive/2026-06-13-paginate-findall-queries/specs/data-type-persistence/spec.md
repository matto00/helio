## MODIFIED Requirements

### Requirement: DataTypeRepository provides async CRUD
The `DataTypeRepository` class SHALL expose `findAll(ownerId: UserId, page: Page): Future[PagedResult[DataType]]`,
`findBySourceId(id, ownerId): Future[Vector[DataType]]`, `findById(id): Future[Option[DataType]]`,
`findById(id, ownerId): Future[Option[DataType]]`, `insert(dt): Future[DataType]`,
`update(dt): Future[Option[DataType]]`, and `delete(id): Future[Boolean]`.
The paginated `findAll` SHALL compose both the count query and slice query into a single DBIO action
so both execute in the same `withUserContext` session.

#### Scenario: Insert sets version to 1
- **WHEN** `insert` is called
- **THEN** the persisted record has `version = 1` regardless of the input value

#### Scenario: findAll with page returns correct PagedResult
- **WHEN** `findAll(ownerId, Page(offset=0, limit=3))` is called and 7 types exist for that owner
- **THEN** the returned `PagedResult` has `items.size == 3` and `total == 7`
