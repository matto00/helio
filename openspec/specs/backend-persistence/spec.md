## Purpose

Defines requirements for the backend's PostgreSQL persistence layer: schema migrations via Flyway, demo data seeding, repository isolation, and database credential configuration.
## Requirements
### Requirement: Dashboard and panel data persists across restarts
The backend SHALL store dashboard and panel data in PostgreSQL so that all data survives a backend restart.

#### Scenario: Data survives restart
- **WHEN** dashboards and panels exist and the backend is restarted
- **THEN** all dashboards and panels are available after restart with their original data intact

### Requirement: Schema managed by Flyway
The backend SHALL apply database migrations automatically on startup using Flyway.

#### Scenario: Fresh database is initialised
- **WHEN** the backend starts against a database with no schema
- **THEN** Flyway applies all pending migrations before accepting requests

### Requirement: Demo data seeds on empty database only
The backend SHALL seed demo dashboards and panels when the database is empty on startup.

#### Scenario: Empty database receives seed data
- **WHEN** the backend starts and the dashboards table is empty
- **THEN** demo dashboards and panels are inserted

#### Scenario: Non-empty database is not reseeded
- **WHEN** the backend starts and the dashboards table has at least one row
- **THEN** no demo data is inserted

### Requirement: Repository layer isolates all database access
The backend SHALL route all dashboard and panel reads and writes through repository classes, with no direct database access in route handlers or other layers.

#### Scenario: Dashboard created via repository
- **WHEN** a POST /api/dashboards request is handled
- **THEN** the new dashboard is written to PostgreSQL via DashboardRepository and the persisted record is returned

#### Scenario: Panel created via repository
- **WHEN** a POST /api/panels request is handled
- **THEN** the new panel is written to PostgreSQL via PanelRepository and the persisted record is returned

### Requirement: Panels table stores DataType binding
The `panels` table SHALL have two nullable columns: `type_id` (text, FK → data_types ON DELETE
SET NULL) and `field_mapping` (jsonb, stores JSON). Both default to NULL for unbound panels.

#### Scenario: Panel without binding has null type_id
- **WHEN** a panel is created without a typeId
- **THEN** the `type_id` and `field_mapping` columns are NULL in the database

#### Scenario: Panel binding persists across restarts
- **WHEN** a panel's typeId and fieldMapping are set via PATCH
- **THEN** the values survive a backend restart and are returned in subsequent GET responses

### Requirement: Database credentials are configurable via environment variables
The backend SHALL support configuring the database username and password via `DB_USER` and `DB_PASSWORD` environment variables, passed to both Flyway and Slick. When absent, the
connection falls back to URL-only authentication suitable for local development.

#### Scenario: Production credentials are used when provided
- **WHEN** the `DB_USER` and `DB_PASSWORD` environment variables are set
- **THEN** Flyway and Slick both connect using those credentials

#### Scenario: Local dev falls back to URL-only auth
- **WHEN** `DB_USER` and `DB_PASSWORD` are not set
- **THEN** Flyway and Slick connect using URL-only authentication with no username/password

### Requirement: Hot filter columns are indexed
The database SHALL have B-tree indexes on `dashboards.owner_id`, `data_sources.owner_id`, `data_types.owner_id`, `panels.type_id`, and `user_sessions.expires_at` so that queries filtering on these columns use index scans rather than full table scans.

#### Scenario: Indexes exist after migration
- **WHEN** the backend starts and Flyway applies V17 or later
- **THEN** indexes `idx_dashboards_owner_id`, `idx_data_sources_owner_id`, `idx_data_types_owner_id`, `idx_panels_type_id`, and `idx_user_sessions_expires_at` exist in the database

#### Scenario: Migration is idempotent via Flyway history
- **WHEN** the backend restarts after V17 has already been applied
- **THEN** Flyway skips V17 and the indexes remain intact

### Requirement: JSON columns use JSONB storage type
The database SHALL store JSON data for `dashboards.appearance`, `dashboards.layout`,
`panels.appearance`, `panels.field_mapping`, `data_sources.config`, `data_types.fields`,
and `data_types.computed_fields` as PostgreSQL `JSONB` rather than `TEXT`. The Flyway
migration SHALL use `ALTER COLUMN ... TYPE JSONB USING ...::jsonb` so existing data is
preserved and validated at migration time.

#### Scenario: JSON column migration applies cleanly
- **WHEN** the backend starts against a database where these columns are still `TEXT`
- **THEN** Flyway migration V33 converts each column to `JSONB` without data loss

#### Scenario: Invalid JSON in a TEXT column blocks migration
- **WHEN** a row contains a value that is not valid JSON in any affected column
- **THEN** the `USING ...::jsonb` cast fails and Flyway rolls back V33, leaving the schema unchanged

#### Scenario: JSON is validated at write time
- **WHEN** an invalid JSON string is written to a JSONB column via any repository
- **THEN** PostgreSQL raises an error before the row is committed

### Requirement: JSON serialization boundary is the Slick mapping layer
The repository layer SHALL serialize and deserialize JSON values exactly once, at the
`MappedColumnType` boundary in each repository companion object. No `.parseJson` /
`.toJson.compactPrint` calls SHALL exist in `rowToDomain`, `domainToRow`, or
`PanelRowMapper` for columns that are now JSONB.

#### Scenario: Dashboard appearance round-trips without double parse
- **WHEN** a dashboard is read from and written to the database
- **THEN** `DashboardAppearance` is deserialized once from the JSONB column value and serialized
  once when the row is written — no intermediate JSON string manipulation in `rowToDomain` or
  `domainToRow`

#### Scenario: Panel fieldMapping round-trips correctly
- **WHEN** a panel row containing a non-null `field_mapping` JSONB value is read
- **THEN** the mapper produces a valid `JsObject` and the domain panel carries the expected
  field mapping without any additional parsing step

