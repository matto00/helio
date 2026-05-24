## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Panels table stores DataType binding
The `panels` table SHALL have two nullable columns: `type_id` (text, FK → data_types ON DELETE
SET NULL) and `field_mapping` (jsonb, stores JSON). Both default to NULL for unbound panels.

#### Scenario: Panel without binding has null type_id
- **WHEN** a panel is created without a typeId
- **THEN** the `type_id` and `field_mapping` columns are NULL in the database

#### Scenario: Panel binding persists across restarts
- **WHEN** a panel's typeId and fieldMapping are set via PATCH
- **THEN** the values survive a backend restart and are returned in subsequent GET responses
