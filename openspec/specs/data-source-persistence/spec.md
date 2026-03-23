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
