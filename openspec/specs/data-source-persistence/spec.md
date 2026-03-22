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
The `DataSourceRepository` class SHALL expose `findAll(): Future[Vector[DataSource]]`, `findById(id): Future[Option[DataSource]]`, `insert(source): Future[DataSource]`, and `delete(id): Future[Boolean]`, all returning `Future`.

#### Scenario: Insert returns the inserted entity
- **WHEN** `insert` is called with a valid `DataSource`
- **THEN** the returned `DataSource` equals the input
