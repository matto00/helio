## ADDED Requirements

### Requirement: Data sources are persisted in the database
The backend SHALL maintain a `data_sources` table with columns: `id` (UUID PK), `name` (text), `source_type` (text, constrained to `rest_api | csv | static`), `config` (text/JSON), `created_at` (timestamptz), `updated_at` (timestamptz).

#### Scenario: Data source is created and retrieved
- **WHEN** a `DataSource` is inserted via `DataSourceRepository.insert`
- **THEN** `DataSourceRepository.findById` returns the same record

#### Scenario: Data source is listed
- **WHEN** multiple data sources have been inserted
- **THEN** `DataSourceRepository.findAll` returns all of them

#### Scenario: Data source is deleted
- **WHEN** `DataSourceRepository.delete` is called with a valid id
- **THEN** `findById` returns `None` for that id

### Requirement: DataSourceRepository provides async CRUD
The `DataSourceRepository` class SHALL expose `findAll(): Future[Vector[DataSource]]`, `findById(id): Future[Option[DataSource]]`, `insert(source): Future[DataSource]`, `update(source): Future[Option[DataSource]]`, and `delete(id): Future[Boolean]`, all returning `Future`.

#### Scenario: Insert returns the inserted entity
- **WHEN** `insert` is called with a valid `DataSource`
- **THEN** the returned `DataSource` equals the input

#### Scenario: Update returns the updated entity
- **WHEN** `update` is called with a modified `DataSource` for an existing id
- **THEN** the returned `Option[DataSource]` is `Some` with the updated values and a refreshed `updatedAt`

#### Scenario: Update returns None for unknown id
- **WHEN** `update` is called with an id that does not exist
- **THEN** the return value is `None`

### Requirement: GET /api/data-sources lists all data sources
The API SHALL expose `GET /api/data-sources` returning all registered data sources as `{"items": [...]}`.

#### Scenario: Empty list is returned when no sources exist
- **WHEN** `GET /api/data-sources` is called with no sources registered
- **THEN** the response is 200 with `{"items": []}`

#### Scenario: All sources are returned
- **WHEN** one or more data sources have been created
- **THEN** `GET /api/data-sources` returns all of them in the `items` array
## ADDED Requirements

### Requirement: POST /api/sources supports optional fieldOverrides
`POST /api/sources` SHALL accept an optional `fieldOverrides` array in the JSON body. Each override is `{ "name": string, "displayName": string, "dataType": string }`. When provided, the inferred `DataField` vector is updated before the `DataType` is inserted: for each field whose `name` matches an override, `displayName` and `dataType` are replaced with the override values. Non-matching fields are left unchanged.

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
`POST /api/data-sources` SHALL accept an optional `fields` multipart part containing a JSON-encoded `Vector[FieldOverridePayload]`. Parsing failures are silently ignored (treated as no overrides). If provided and parseable, overrides are applied to the inferred `DataField` vector before `DataType` insertion, using the same matching logic as `POST /api/sources`.

#### Scenario: CSV field override is applied
- **WHEN** `POST /api/data-sources` is called with a CSV file and a `fields` part containing `[{ "name": "value", "displayName": "Sale Value", "dataType": "float" }]`
- **THEN** the created `DataType` contains a field named `value` with `displayName = "Sale Value"`
