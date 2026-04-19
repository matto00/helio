## MODIFIED Requirements

### Requirement: Data sources are persisted in the database
The backend SHALL maintain a `data_sources` table with columns: `id` (UUID PK), `name` (text),
`source_type` (text, constrained to `rest_api | csv | static | sql`), `config` (text/JSON),
`created_at` (timestamptz), `updated_at` (timestamptz).

#### Scenario: Data source is created and retrieved
- **WHEN** a `DataSource` is inserted via `DataSourceRepository.insert`
- **THEN** `DataSourceRepository.findById` returns the same record

#### Scenario: Data source is listed
- **WHEN** multiple data sources have been inserted
- **THEN** `DataSourceRepository.findAll` returns all of them

#### Scenario: Data source is deleted
- **WHEN** `DataSourceRepository.delete` is called with a valid id
- **THEN** `findById` returns `None` for that id

#### Scenario: SQL source type is accepted
- **WHEN** a `DataSource` with `source_type = "sql"` is inserted via `DataSourceRepository.insert`
- **THEN** `DataSourceRepository.findById` returns the record with `source_type = "sql"`
