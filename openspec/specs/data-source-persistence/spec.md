# data-source-persistence Specification

## Purpose
Defines persistence requirements for Data Sources: the data_sources table schema, repository CRUD contract,
owner_id isolation, and related API behaviors.
## Requirements
### Requirement: Data sources are persisted in the database
The backend SHALL maintain a `data_sources` table with columns: `id` (UUID PK), `name` (text), `source_type`
(text, constrained to `rest_api | csv | static | sql`), `config` (text/JSON), `owner_id` (UUID, nullable),
`created_at` (timestamptz), `updated_at` (timestamptz).

#### Scenario: Data source is created and retrieved
- **WHEN** a `DataSource` is inserted via `DataSourceRepository.insert`
- **THEN** `DataSourceRepository.findById` returns the same record

#### Scenario: Data source is listed
- **WHEN** multiple data sources have been inserted for the same owner
- **THEN** `DataSourceRepository.findAll(ownerId)` returns all of them

#### Scenario: Data source is deleted
- **WHEN** `DataSourceRepository.delete` is called with a valid id
- **THEN** `findById` returns `None` for that id

### Requirement: DataSourceRepository provides async CRUD
The `DataSourceRepository` class SHALL expose `findAll(ownerId: UserId): Future[Vector[DataSource]]`,
`findById(id): Future[Option[DataSource]]`, `insert(source): Future[DataSource]`,
`update(source): Future[Option[DataSource]]`, and `delete(id): Future[Boolean]`, all returning `Future`.

#### Scenario: Insert returns the inserted entity
- **WHEN** `insert` is called with a valid `DataSource`
- **THEN** the returned `DataSource` equals the input

#### Scenario: Update returns the updated entity
- **WHEN** `update` is called with a modified `DataSource` for an existing id
- **THEN** the returned `Option[DataSource]` is `Some` with the updated values and a refreshed `updatedAt`

#### Scenario: Update returns None for unknown id
- **WHEN** `update` is called with an id that does not exist
- **THEN** the return value is `None`

### Requirement: GET /api/data-sources lists all data sources for the authenticated user
The API SHALL expose `GET /api/data-sources` returning only the requesting user's data sources as
`{"items": [...]}`.

#### Scenario: Empty list is returned when user has no sources
- **WHEN** `GET /api/data-sources` is called with no sources registered for that user
- **THEN** the response is 200 with `{"items": []}`

#### Scenario: Only the owner's sources are returned
- **WHEN** multiple users have created data sources
- **THEN** `GET /api/data-sources` returns only the requesting user's sources

### Requirement: POST /api/sources supports optional fieldOverrides
`POST /api/sources` SHALL accept an optional `fieldOverrides` array in the JSON body. Each override is
`{ "name": string, "displayName": string, "dataType": string }`. When provided, the inferred `DataField`
vector is updated before the `DataType` is inserted: for each field whose `name` matches an override,
`displayName` and `dataType` are replaced with the override values. Non-matching fields are left unchanged.

#### Scenario: Override is applied to matching field
- **WHEN** `POST /api/sources` is called with `fieldOverrides: [{ "name": "revenue", "displayName": "Total Revenue", "dataType": "float" }]`
- **THEN** the created `DataType` contains a field named `revenue` with `displayName = "Total Revenue"` and `dataType = "float"`

#### Scenario: Non-matching overrides are ignored
- **WHEN** `fieldOverrides` contains an entry whose `name` does not match any inferred field
- **THEN** the override is silently ignored and the created `DataType` is unaffected

#### Scenario: Absent fieldOverrides leaves inferred schema unchanged
- **WHEN** `POST /api/sources` is called with no `fieldOverrides` property
- **THEN** the created `DataType` reflects the raw inferred schema

### Requirement: POST /api/data-sources supports optional fieldOverrides via multipart
`POST /api/data-sources` SHALL accept an optional `fields` multipart part containing a JSON-encoded
`Vector[FieldOverridePayload]`. Parsing failures are silently ignored (treated as no overrides). If
provided and parseable, overrides are applied to the inferred `DataField` vector before `DataType`
insertion, using the same matching logic as `POST /api/sources`.

#### Scenario: CSV field override is applied
- **WHEN** `POST /api/data-sources` is called with a CSV file and a `fields` part containing `[{ "name": "value", "displayName": "Sale Value", "dataType": "float" }]`
- **THEN** the created `DataType` contains a field named `value` with `displayName = "Sale Value"`

### Requirement: Static source config shape is persisted in config JSONB
The `data_sources.config` JSONB column SHALL store `{ "columns": [{ "name": string, "type": string }], "rows": [[...]] }`
for sources with `source_type = "static"`. The `DataSourceRepository.updateStaticPayload` method
SHALL be used to replace this config on refresh; the typed `StaticSource` ADT itself does not
carry the payload (which would force the engine to round-trip a potentially-large blob through
the ADT on every read).

#### Scenario: Static config is round-tripped through the repository
- **WHEN** a `StaticSource` is inserted and its `{columns, rows}` payload is written via `updateStaticPayload`
- **THEN** `DataSourceRepository.readRawConfig` returns the same `config` JSON value unchanged

#### Scenario: Config is replaced on update
- **WHEN** `DataSourceRepository.updateStaticPayload` is called with a modified payload for an existing static source
- **THEN** `readRawConfig` returns the source's updated config payload

### Requirement: SQL source type is accepted in data_sources
The `source_type` column in the `data_sources` table SHALL accept the value `"sql"` in addition to the
existing `rest_api`, `csv`, and `static` values.

#### Scenario: SQL source type is accepted
- **WHEN** a `DataSource` with `source_type = "sql"` is inserted via `DataSourceRepository.insert`
- **THEN** `DataSourceRepository.findById` returns the record with `source_type = "sql"`

### Requirement: data_sources table has an owner_id column
A Flyway migration SHALL add an `owner_id UUID` column to the `data_sources` table. Existing rows will
have `owner_id = NULL` and be treated as unowned (invisible to all users).

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
the given user ID.

#### Scenario: findAll returns only the owner's sources
- **WHEN** sources for two different users exist and `findAll(userAId)` is called
- **THEN** only user A's sources are returned

### Requirement: DataSourceRepository.findById is available in unscoped form for ACL resolver
`DataSourceRepository.findById(id: DataSourceId)` SHALL return the source regardless of owner, for use
by the AclDirective resolver which performs its own ownership check.

#### Scenario: findById returns the source for any caller
- **WHEN** `findById` is called with a valid id
- **THEN** the result is `Some(source)` regardless of the caller's identity

