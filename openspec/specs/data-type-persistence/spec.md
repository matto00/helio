# data-type-persistence Specification

## Purpose
Defines persistence requirements for Data Types (Type Registry): the data_types table schema,
repository CRUD contract, owner_id isolation, and version tracking.
## Requirements
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

### Requirement: Companion DataTypes are internal source-schema records
A DataType with a non-null `source_id` (companion type, auto-created at source registration) SHALL serve
only as the source's schema record — feeding pipeline analyze, source preview computed fields, refresh
upserts, and source schema display. Companion types SHALL NOT be offered as panel binding targets; only
pipeline-output DataTypes (`source_id IS NULL`) are user-facing registry entries.

#### Scenario: Source registration still creates a companion type
- **WHEN** a data source is registered (CSV, static, REST, or SQL)
- **THEN** a companion DataType with `source_id = <source id>` is created carrying the inferred schema

#### Scenario: Companion types remain resolvable by source
- **WHEN** `DataTypeRepository.findBySourceId` is called for a registered source
- **THEN** the companion DataType is returned for analyze/preview/refresh consumers

### Requirement: One-time migration converts panel-bound companion types (V41)
A Flyway migration (V41) SHALL, for each DataType with `source_id IS NOT NULL` bound by at least one panel
(`panels.type_id`): create a zero-step pass-through pipeline from the companion's source to that DataType,
set the DataType's `source_id` to NULL, and insert a replacement companion DataType (new id, same
name/fields/computed_fields, `version = 1`, same `owner_id`) for the source. Panel bindings and
`data_type_rows` snapshots SHALL be left untouched. Companion types with no bound panels are unchanged.

#### Scenario: Bound companion type becomes a pipeline output
- **WHEN** V41 runs against a database where a panel binds a DataType with `source_id` set
- **THEN** that DataType afterwards has `source_id = NULL`, a pipeline exists with it as
  `output_data_type_id` and the original source as `source_data_source_id`, and the panel's `type_id` is
  unchanged

#### Scenario: Source retains exactly one companion type
- **WHEN** V41 converts a source's panel-bound companion type
- **THEN** a new companion DataType with the same schema exists for that source

#### Scenario: Unbound companion types are untouched
- **WHEN** V41 runs against a companion DataType with no bound panels
- **THEN** the row is unchanged

