## ADDED Requirements

### Requirement: data_types table has an owner_id column
A Flyway migration SHALL add an `owner_id UUID` column to the `data_types` table. Existing rows will
have `owner_id = NULL`.

#### Scenario: Migration adds column without breaking existing rows
- **WHEN** the migration runs against a database with existing data_type rows
- **THEN** those rows have `owner_id = NULL` and remain queryable

### Requirement: DataType domain model carries ownerId
The `DataType` case class SHALL include an `ownerId: UserId` field. All construction sites
(routes, DemoData, tests) SHALL supply this value.

#### Scenario: DataType is constructed with ownerId
- **WHEN** a `DataType` is created with a given `ownerId`
- **THEN** `DataTypeRepository.findById` with a matching ownerId returns the type with the same `ownerId`

### Requirement: DataTypeRepository.findAll filters by ownerId
`DataTypeRepository.findAll(ownerId: UserId)` SHALL return only types where `owner_id` matches the
given user. The no-arg variant SHALL be removed.

#### Scenario: findAll returns only the owner's types
- **WHEN** types for two different users exist and `findAll(userAId)` is called
- **THEN** only user A's types are returned

### Requirement: DataTypeRepository.findBySourceId filters by ownerId
`DataTypeRepository.findBySourceId(id: DataSourceId, ownerId: UserId)` SHALL only return types where
`owner_id` matches the given user.

#### Scenario: findBySourceId returns only the owner's types for a source
- **WHEN** types for two users share the same source_id
- **THEN** `findBySourceId(sourceId, userAId)` returns only user A's type

### Requirement: DataTypeRepository.findById with ownerId guard supports cross-user unbound resolution
An overload or variant `findById(id: DataTypeId, ownerId: UserId): Future[Option[DataType]]` SHALL
return `None` when the type exists but `owner_id` does not match. This variant is used by the panel
read path to produce the unbound-on-mismatch behavior.

#### Scenario: findById returns None when ownerId does not match
- **WHEN** `findById(id, differentUserId)` is called
- **THEN** the result is `None`

#### Scenario: findById returns Some when ownerId matches
- **WHEN** `findById(id, correctOwnerId)` is called
- **THEN** the result is `Some(dataType)`
