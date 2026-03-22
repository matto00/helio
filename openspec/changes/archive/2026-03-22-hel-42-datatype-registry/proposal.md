## Why

Connectors (CSV upload, REST API) need somewhere to register the data types they infer and persist the data source configurations that produced them. Without `data_sources` and `data_types` tables — and repositories to access them — no subsequent data ingestion ticket can persist anything.

## What Changes

- Add Flyway migration `V4__data_sources_and_types.sql` creating the `data_sources` and `data_types` tables
- Add domain models: `DataSourceId`, `DataTypeId`, `SourceType`, `DataSource`, `DataField`, `DataType` to `model.scala`
- Add `DataSourceRepository` (Slick) with `findAll`, `findById`, `insert`, `delete`
- Add `DataTypeRepository` (Slick) with `findAll`, `findBySourceId`, `findById`, `insert`, `update`, `delete`
- Wire both repositories in `Main` alongside the existing dashboard/panel repos

## Capabilities

### New Capabilities

- `data-source-persistence`: CRUD persistence for data sources (`data_sources` table + `DataSourceRepository`)
- `data-type-persistence`: CRUD persistence for registered data types (`data_types` table + `DataTypeRepository`)

### Modified Capabilities

<!-- none — no existing spec-level behavior changes -->

## Impact

- **New migration**: `backend/src/main/resources/db/migration/V4__data_sources_and_types.sql`
- **Modified**: `backend/src/main/scala/com/helio/domain/model.scala` — new domain types
- **New files**: `DataSourceRepository.scala`, `DataTypeRepository.scala` in `com.helio.infrastructure`
- **Modified**: `Main.scala` — instantiate and hold both new repos
- **New test**: `DataTypeRepositorySpec.scala` + `DataSourceRepositorySpec.scala` using embedded Postgres
- No API routes in this ticket (HEL-46 adds REST endpoints); no frontend changes
