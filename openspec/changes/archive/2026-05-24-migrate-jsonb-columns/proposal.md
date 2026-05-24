## Why

Several database columns (`dashboards.appearance`, `dashboards.layout`, `panels.appearance`,
`panels.field_mapping`, `data_sources.config`, `data_types.fields`, `data_types.computed_fields`)
store JSON as plain `TEXT`, forcing every repository to manually serialize/deserialize on each
read/write. Switching to PostgreSQL's native `JSONB` type removes that overhead, adds DB-level
JSON validation, and opens the door to GIN indexing in a future release.

## What Changes

- Flyway migration `ALTER COLUMN ... TYPE JSONB USING ...::jsonb` for all seven affected columns
  across four tables (`dashboards`, `panels`, `data_sources`, `data_types`)
- A shared `MappedColumnType` (`JsonbColumnType`) in the backend that maps `String ↔ JSONB` for
  use in Slick table definitions — Slick has no native JSONB support
- All four repository files updated to use the new column type; manual `.parseJson` /
  `.toJson.compactPrint` calls removed (serialization happens at the mapping boundary)
- No API contract changes — request/response shapes are unchanged

## Capabilities

### New Capabilities
<!-- None — this is a purely internal storage migration with no new external behaviour. -->

### Modified Capabilities
- `backend-persistence`: Column storage type for JSON columns changes from TEXT to JSONB; Flyway
  migration requirement updated to cover the new ALTER COLUMN step

## Impact

- **Files changed**: one new Flyway SQL migration; `DashboardRepository.scala`,
  `PanelRepository.scala`, `DataSourceRepository.scala`, `DataTypeRepository.scala`, plus a new
  shared `JsonbSupport` helper (or inline `MappedColumnType` in each table definition)
- **Open PR overlap**: HEL-131 (PR #169) also touches `DataTypeRepository.scala` — this change
  should be rebased after HEL-131 merges, or it will need a merge-conflict resolution on that file
- **Risk**: Flyway migration is destructive on the column type; standard rollback is a new
  migration casting back to `TEXT`. Test against a pg_dump snapshot before production rollout.

## Non-goals

- No GIN index creation in this ticket (deferred)
- No API schema changes
- No AuthService modifications
