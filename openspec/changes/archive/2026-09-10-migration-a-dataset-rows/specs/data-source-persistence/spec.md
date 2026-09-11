## MODIFIED Requirements

### Requirement: Data sources are persisted in the database
The backend SHALL maintain a `data_sources` table with columns: `id` (TEXT PK), `name` (text),
`source_type` (text, constrained to `rest_api | csv | dataset | sql | text | pdf | image`), `config`
(jsonb), `owner_id` (UUID, nullable), `created_at` (timestamptz), `updated_at` (timestamptz), and
`dataset_schema` (jsonb, nullable — the user-declared/backfilled schema for `dataset`-kind sources,
backfilled from each migrated row's declared `config->'columns'`, not its runtime-inferred schema;
`NULL` for every other `source_type`).

#### Scenario: Data source is created and retrieved
- **WHEN** a `DataSource` is inserted via `DataSourceRepository.insert`
- **THEN** `DataSourceRepository.findById` returns the same record

#### Scenario: Data source is listed
- **WHEN** multiple data sources have been inserted for the same owner
- **THEN** `DataSourceRepository.findAll(ownerId)` returns all of them

#### Scenario: Data source is deleted
- **WHEN** `DataSourceRepository.delete` is called with a valid id
- **THEN** `findById` returns `None` for that id

#### Scenario: Existing static sources are migrated to dataset with a backfilled schema
- **WHEN** the Migration A Flyway script runs against a database containing `source_type = 'static'` sources
- **THEN** each is left with `source_type = 'dataset'` and a non-null `dataset_schema` reflecting that
  source's declared column list (`COALESCE(config->'columns', '[]'::jsonb)`, name and declared type, in
  order) — not its runtime-inferred schema, which may disagree with the declared type; a source whose
  `config` is `'{}'` ends with `dataset_schema: []`, never `NULL`

#### Scenario: The source_type CHECK constraint rejects static for new rows
- **WHEN** an `INSERT` into `data_sources` specifies `source_type = 'static'` after the migration
- **THEN** the insert is rejected by the `data_sources_source_type_check` CHECK constraint (the
  wire-level `"static"` alias, if any, is resolved to `"dataset"` before reaching persistence — see
  HEL-1073)

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
- **THEN** the returned value is `None`
