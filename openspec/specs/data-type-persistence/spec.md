## ADDED Requirements

### Requirement: Data types are persisted in the database
The backend SHALL maintain a `data_types` table with columns: `id` (UUID PK), `source_id` (UUID FK → data_sources, nullable, ON DELETE SET NULL), `name` (text), `fields` (text/JSON array of `{name, displayName, dataType, nullable}`), `version` (int), `created_at` (timestamptz), `updated_at` (timestamptz).

#### Scenario: Data type is created and retrieved
- **WHEN** a `DataType` is inserted via `DataTypeRepository.insert`
- **THEN** `DataTypeRepository.findById` returns the same record with `version = 1`

#### Scenario: Data type version increments on update
- **WHEN** `DataTypeRepository.update` is called on an existing data type
- **THEN** the returned record has `version` incremented by 1

#### Scenario: Data types are listed by source
- **WHEN** multiple data types share the same `sourceId`
- **THEN** `DataTypeRepository.findBySourceId` returns all of them

#### Scenario: Deleting a data source orphans its data types
- **WHEN** the parent `DataSource` is deleted
- **THEN** associated `DataType` records have `sourceId = None` (FK set null) and are still retrievable

### Requirement: DataTypeRepository provides async CRUD
The `DataTypeRepository` class SHALL expose `findAll(): Future[Vector[DataType]]`, `findBySourceId(id): Future[Vector[DataType]]`, `findById(id): Future[Option[DataType]]`, `insert(dt): Future[DataType]`, `update(dt): Future[Option[DataType]]`, and `delete(id): Future[Boolean]`.

#### Scenario: Insert sets version to 1
- **WHEN** `insert` is called
- **THEN** the persisted record has `version = 1` regardless of the input value

### Requirement: DataTypeRepository can check if a type is bound to any panel
The `DataTypeRepository` SHALL expose `isBoundToAnyPanel(id: DataTypeId): Future[Boolean]` that returns `true` if one or more panels have `type_id = id`.

#### Scenario: Unbound type returns false
- **WHEN** `isBoundToAnyPanel` is called for a type with no bound panels
- **THEN** it returns `false`

#### Scenario: Bound type returns true
- **WHEN** at least one panel has `type_id` set to the given DataTypeId
- **THEN** `isBoundToAnyPanel` returns `true`
