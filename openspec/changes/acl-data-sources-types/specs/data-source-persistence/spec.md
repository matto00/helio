## ADDED Requirements

### Requirement: data_sources table has an owner_id column
A Flyway migration SHALL add an `owner_id UUID` column to the `data_sources` table. Existing rows will
have `owner_id = NULL`.

#### Scenario: Migration adds column without breaking existing rows
- **WHEN** the migration runs against a database with existing data_source rows
- **THEN** those rows have `owner_id = NULL` and remain queryable

### Requirement: DataSource domain model carries ownerId
The `DataSource` case class SHALL include an `ownerId: UserId` field. All construction sites
(routes, DemoData, tests) SHALL supply this value.

#### Scenario: DataSource is constructed with ownerId
- **WHEN** a `DataSource` is created with a given `ownerId`
- **THEN** `DataSourceRepository.findById` returns the source with the same `ownerId`

### Requirement: DataSourceRepository.findAll filters by ownerId
`DataSourceRepository.findAll(ownerId: UserId)` SHALL return only sources where `owner_id` matches
the given user ID. The no-arg variant SHALL be removed.

#### Scenario: findAll returns only the owner's sources
- **WHEN** sources for two different users exist and `findAll(userAId)` is called
- **THEN** only user A's sources are returned

### Requirement: DataSourceRepository.findById is scoped to the owner
`DataSourceRepository.findById(id: DataSourceId, ownerId: UserId)` SHALL return `None` when the source
exists but `owner_id` does not match the given user. The no-arg-owner variant SHALL be removed from
public API (routes use the owner-scoped variant).

#### Scenario: findById returns None for wrong owner
- **WHEN** `findById` is called with a valid id but a different user's ownerId
- **THEN** the result is `None`

#### Scenario: findById returns the source for the correct owner
- **WHEN** `findById` is called with the correct ownerId
- **THEN** the result is `Some(source)`
