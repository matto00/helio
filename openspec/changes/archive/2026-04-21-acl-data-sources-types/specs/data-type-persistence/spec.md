## MODIFIED Requirements

### Requirement: Data types are persisted in the database
The backend SHALL maintain a `data_types` table with columns: `id` (UUID PK), `source_id` (UUID FK →
data_sources, nullable, ON DELETE SET NULL), `name` (text), `fields` (text/JSON array of
`{name, displayName, dataType, nullable}`), `version` (int), `owner_id` (UUID, nullable),
`created_at` (timestamptz), `updated_at` (timestamptz).

#### Scenario: Data type is created and retrieved
- **WHEN** a `DataType` is inserted via `DataTypeRepository.insert`
- **THEN** `DataTypeRepository.findById` returns the same record with `version = 1`

#### Scenario: Data type version increments on update
- **WHEN** `DataTypeRepository.update` is called on an existing data type
- **THEN** the returned record has `version` incremented by 1

#### Scenario: Data types are listed by source
- **WHEN** multiple data types share the same `sourceId` and owner
- **THEN** `DataTypeRepository.findBySourceId(id, ownerId)` returns all of them for that owner

#### Scenario: Deleting a data source orphans its data types
- **WHEN** the parent `DataSource` is deleted
- **THEN** associated `DataType` records have `sourceId = None` (FK set null) and are still retrievable

### Requirement: DataTypeRepository provides async CRUD
The `DataTypeRepository` class SHALL expose `findAll(ownerId: UserId): Future[Vector[DataType]]`,
`findBySourceId(id, ownerId): Future[Vector[DataType]]`, `findById(id): Future[Option[DataType]]`,
`findById(id, ownerId): Future[Option[DataType]]`, `insert(dt): Future[DataType]`,
`update(dt): Future[Option[DataType]]`, and `delete(id): Future[Boolean]`.

#### Scenario: Insert sets version to 1
- **WHEN** `insert` is called
- **THEN** the persisted record has `version = 1` regardless of the input value

### Requirement: DataTypeRepository can check if a type is bound to any panel
The `DataTypeRepository` SHALL expose `isBoundToAnyPanel(id: DataTypeId): Future[Boolean]` that
returns `true` if one or more panels have `type_id = id`.

#### Scenario: Unbound type returns false
- **WHEN** `isBoundToAnyPanel` is called for a type with no bound panels
- **THEN** it returns `false`

#### Scenario: Bound type returns true
- **WHEN** at least one panel has `type_id` set to the given DataTypeId
- **THEN** `isBoundToAnyPanel` returns `true`

### Requirement: data_types table has an owner_id column
A Flyway migration SHALL add an `owner_id UUID` column to the `data_types` table. Existing rows will
have `owner_id = NULL` and be treated as unowned (invisible to all users).

#### Scenario: Migration adds column without breaking existing rows
- **WHEN** the migration runs against a database with existing data_type rows
- **THEN** those rows have `owner_id = NULL` and remain queryable

### Requirement: DataType domain model carries ownerId
The `DataType` case class SHALL include an `ownerId: UserId` field. All construction sites
(routes, DemoData, tests) SHALL supply this value.

#### Scenario: DataType is constructed with ownerId
- **WHEN** a `DataType` is created with a given `ownerId`
- **THEN** `DataTypeRepository.findById(id, ownerId)` returns the type with the same `ownerId`

### Requirement: DataTypeRepository.findAll filters by ownerId
`DataTypeRepository.findAll(ownerId: UserId)` SHALL return only types where `owner_id` matches the
given user.

#### Scenario: findAll returns only the owner's types
- **WHEN** types for two different users exist and `findAll(userAId)` is called
- **THEN** only user A's types are returned

### Requirement: DataTypeRepository.findById with ownerId guard supports cross-user unbound resolution
`findById(id: DataTypeId, ownerId: UserId): Future[Option[DataType]]` SHALL return `None` when the
type exists but `owner_id` does not match. This variant is used by the panel read path to produce
unbound-on-mismatch behavior.

#### Scenario: findById returns None when ownerId does not match
- **WHEN** `findById(id, differentUserId)` is called
- **THEN** the result is `None`

#### Scenario: findById returns Some when ownerId matches
- **WHEN** `findById(id, correctOwnerId)` is called
- **THEN** the result is `Some(dataType)`
