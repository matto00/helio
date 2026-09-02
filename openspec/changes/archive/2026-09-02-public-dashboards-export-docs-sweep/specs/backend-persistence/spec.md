## MODIFIED Requirements

### Requirement: Hot filter columns are indexed

The database SHALL have B-tree indexes on `dashboards.owner_id`, `data_sources.owner_id`,
`outputs.owner_id`, and `user_sessions.expires_at` so that queries filtering on these columns
use index scans rather than full table scans. (`data_types.owner_id` and `panels.type_id`
were dropped outright by HEL-903/904's Pipelines & Outputs remodel, along with the
`data_types` table and the `panels.type_id` column themselves — no successor index for
either is required, since neither column exists any more.)

#### Scenario: Indexes exist after migration

- **WHEN** the backend starts and Flyway applies the latest migrations
- **THEN** indexes `idx_dashboards_owner_id`, `idx_data_sources_owner_id`,
  `idx_outputs_owner_id`, and `idx_user_sessions_expires_at` exist in the database

#### Scenario: Migration is idempotent via Flyway history

- **WHEN** the backend restarts after its index migrations have already been applied
- **THEN** Flyway skips already-applied migrations and the indexes remain intact

### Requirement: JSON columns use JSONB storage type

The database SHALL store JSON data for `dashboards.appearance`, `dashboards.layout`,
`panels.appearance`, `panels.field_mapping`, `data_sources.config`, and `outputs.config` as
PostgreSQL `JSONB` rather than `TEXT`. (`data_types.fields` and `data_types.computed_fields`
no longer exist — the `data_types` table was dropped outright by HEL-903/904; computed
fields became pipeline `compute` steps, not a stored JSONB column.) Any migration that
converts a column's storage type SHALL use `ALTER COLUMN ... TYPE JSONB USING ...::jsonb`
so existing data is preserved and validated at migration time.

#### Scenario: JSON column migration applies cleanly

- **WHEN** the backend starts against a database where a still-live JSON column is stored as `TEXT`
- **THEN** the relevant Flyway migration converts that column to `JSONB` without data loss

#### Scenario: Invalid JSON in a TEXT column blocks migration

- **WHEN** a row contains a value that is not valid JSON in any affected column
- **THEN** the `USING ...::jsonb` cast fails and the migration rolls back, leaving the schema unchanged

#### Scenario: JSON is validated at write time

- **WHEN** an invalid JSON string is written to a JSONB column via any repository
- **THEN** PostgreSQL raises an error before the row is committed

### Requirement: Typed MappedColumnType for JSONB-backed domain fields

The Slick repository layer SHALL define a `MappedColumnType` for each JSONB column that
maps to a stable Scala domain type, so that row case classes carry the parsed domain type
directly and repository methods contain no manual `.parseJson` / `.toJson.compactPrint`
calls for those columns.

The affected columns and their Scala target types are:

- `dashboards.appearance` → `DashboardAppearance`
- `dashboards.layout` → `DashboardLayout`
- `panels.appearance` → `PanelAppearance`
- `outputs.config` → the per-kind `OutputConfig` ADT

(`data_types.fields` → `Vector[DataField]` and `data_types.computed_fields` →
`Vector[ComputedField]` are removed outright — the `data_types` table itself was dropped by
HEL-903/904, so there is no successor typed mapping to list.)

The `panels.field_mapping` column (JSONB, `Option[String]` in the row) and
`data_sources.config` (polymorphic blob) are explicitly excluded from typed mapping.

#### Scenario: DashboardRow carries DashboardAppearance directly

- **WHEN** a dashboard row is loaded from the database
- **THEN** `DashboardRow.appearance` is a `DashboardAppearance` value, not a raw JSON string

#### Scenario: DashboardRow carries DashboardLayout directly

- **WHEN** a dashboard row is loaded from the database
- **THEN** `DashboardRow.layout` is a `DashboardLayout` value, not a raw JSON string

#### Scenario: PanelRow carries PanelAppearance directly

- **WHEN** a panel row is loaded from the database
- **THEN** `PanelRow.appearance` is a `PanelAppearance` value, not a raw JSON string

#### Scenario: DataTypeRow carries typed field vectors

- **WHEN** this scenario is read (retired — `DataTypeRow`/`data_types` no longer exist; the
  `data_types` table was dropped outright by HEL-903/904)
- **THEN** it describes no reachable behavior; kept here, unreachable, only because the
  OpenSpec archive tooling requires every previously-listed scenario name to still appear in
  a MODIFIED requirement's block

### Requirement: Panels table stores an Output placement

The `panels` table SHALL have a nullable `output_id` (text, FK → `outputs` `ON DELETE CASCADE`)
column, populated only for panels with `kind = output`. The previously-required `type_id`
(FK → `data_types`) and `field_mapping` columns no longer exist.

#### Scenario: Panel without binding has null type_id

- **WHEN** a content panel (text, markdown, image, divider) is created
- **THEN** the `output_id` column is NULL in the database (the scenario's own name is a stale
  holdover from before `type_id` was renamed/dropped — kept verbatim because a MODIFIED
  requirement's block must retain every previously-listed scenario name)

#### Scenario: Panel binding persists across restarts

- **WHEN** a panel's `output_id` is set via `POST /api/panels`
- **THEN** the value survives a backend restart and is returned in subsequent GET responses
