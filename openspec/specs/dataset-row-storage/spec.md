# dataset-row-storage Specification

## Purpose
Defines the row-level storage for `dataset`-kind sources: a dedicated `dataset_rows` table with
per-row addressing and owner-scoped forced RLS, replacing the single-blob `data_sources.config` storage
that `static` sources used.

## Requirements

### Requirement: Dataset rows are stored in a dedicated table
The backend SHALL maintain a `dataset_rows` table with columns `id` (TEXT PK, matching
`data_sources.id`'s existing TEXT type), `data_source_id` (TEXT, references `data_sources.id`), `seq`
(bigint, monotonically increasing per source), `data` (jsonb, a **positional JSON array** aligned to
the owning source's `dataset_schema` column order — the same shape a `static` source's `config->'rows'`
array element already held; not an object keyed by column name), `created_at` (timestamptz),
`updated_at` (timestamptz), with a `UNIQUE (data_source_id, seq)` constraint.

#### Scenario: A migrated static source's rows are queryable by id
- **WHEN** a `static`-kind source with 3 rows in `data_sources.config` is migrated
- **THEN** `dataset_rows` contains exactly 3 rows for that `data_source_id`, each with a stable `id`,
  `data` exactly equal (positionally, value-for-value) to the corresponding original blob row, and
  `seq` reflecting the original row order

#### Scenario: A source with duplicate column names or ragged rows migrates losslessly
- **WHEN** a `static`-kind source whose declared `columns` contains a duplicate name, or whose stored
  rows are longer or shorter than `columns`, is migrated
- **THEN** each row's `data` is copied verbatim as a positional array (no per-column key collapse, no
  padding or truncation), preserving exactly what the blob held

#### Scenario: A source with an empty config migrates to zero rows and an empty declared schema
- **WHEN** a `static`-kind source whose `config` is `'{}'` (the pre-existing rename-wipes-rows state) is
  migrated
- **THEN** it ends with zero `dataset_rows` and a non-null, empty `dataset_schema` (`[]`), never `NULL`
  and never a migration failure

### Requirement: Dataset rows are protected by forced RLS scoped through the owning source
The backend SHALL enforce a forced row-level-security policy on `dataset_rows` restricting access to
rows whose `data_source_id` resolves (via `data_sources.owner_id`) to the current session's
authenticated user, mirroring the existing `data_sources_owner` policy on `data_sources`.

#### Scenario: A non-owner cannot read another user's dataset rows
- **WHEN** a non-superuser database session authenticated as user A queries `dataset_rows` for a
  `data_source_id` owned by user B
- **THEN** zero rows are returned, regardless of the query's own WHERE clause

#### Scenario: Migration backfill inserts succeed under forced RLS
- **WHEN** the Flyway migration backfills `dataset_rows` from `data_sources.config` while running as the
  non-BYPASSRLS `helio` role (via a `NO FORCE`/`FORCE` bracket on `data_sources`, matching the
  established pattern in `V94`/`V96` — not per-row session-variable manipulation)
- **THEN** every row is inserted successfully and is subsequently visible to that row's owning user under
  the same non-superuser role

#### Scenario: A source with no owner migrates rows that remain invisible to every user
- **WHEN** a `static`-kind source with `owner_id IS NULL` (the existing, documented posture for
  owner-scoped tables — rows without an owner are invisible on the app pool) is migrated
- **THEN** its `dataset_rows` are backfilled successfully but are not visible to any non-privileged user
  session, only via the privileged (`withSystemContext`) pool

### Requirement: Legacy blob readers are migrated to the new table
The backend SHALL read dataset/static row data exclusively from `dataset_rows` for `dataset`-kind
sources; no production code path SHALL read row data for a `dataset`-kind source from
`data_sources.config` after this migration.

#### Scenario: Pipeline engine reads migrated rows identically to the pre-migration blob read
- **WHEN** a pipeline step sources from a migrated `dataset`-kind source
- **THEN** the rows produced (values, order, and inferred types) are identical to what the pre-migration
  `readRawConfig`/`parseStaticPayload` path would have produced for the same source, verified by an
  explicit before/after comparison on a real fixture

#### Scenario: Preview reads migrated rows identically to the pre-migration blob read
- **WHEN** `DataSourceService.previewStatic` (or its post-migration equivalent) is called for a migrated
  `dataset`-kind source
- **THEN** the preview response is identical to the pre-migration response for the same source
