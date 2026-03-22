## Context

The existing codebase uses Slick repositories (not Akka actors) for all DB access. `DashboardRepository` and `PanelRepository` share the same pattern: a `class Repo(db)(implicit ec)`, a private `TableQuery`, `Row` case class, `Table` class, and async methods returning `Future`. This ticket adds two more repositories following the same idiom.

The `data_sources` → `data_types` relationship is one-to-many with nullable FK (manual types have no source). `fields` and `config` are stored as JSONB columns serialised with Spray JSON, consistent with how `appearance` and `layout` are handled today.

## Goals / Non-Goals

**Goals:**
- Flyway migration V4 creating `data_sources` and `data_types` tables with correct types, constraints, and indexes
- Domain models for `DataSource`, `DataType`, `DataField`, `SourceType` in `model.scala`
- `DataSourceRepository`: `findAll`, `findById`, `insert`, `delete`
- `DataTypeRepository`: `findAll`, `findBySourceId`, `findById`, `insert`, `update`, `delete`; `update` increments `version`
- Both repos wired in `Main`
- Integration tests using embedded Postgres (same pattern as `ApiRoutesSpec`)

**Non-Goals:**
- REST API routes (HEL-46)
- Schema inference (HEL-43)
- Connector implementations (HEL-44, HEL-45)
- `typeId` on panels (HEL-46)

## Decisions

**`source_type` as TEXT with a CHECK constraint (not a PG enum)**
PG enums require DDL to add values; TEXT + CHECK is Flyway-friendly and lets us add types without a migration. Consistent with how `panels.type` is stored.

**`config` as TEXT (JSON string) not native JSONB column**
Slick's PostgresProfile doesn't support native JSONB without extra drivers. Existing code stores `appearance`/`layout` as `TEXT` and parses with Spray JSON — same approach here for `config` and `fields`.

**`version` starts at 1 on insert, incremented by repository on update**
Caller does not set version; `DataTypeRepository.update` always does `version + 1` in the DB query to avoid lost-update races.

**Nullable `source_id` on `data_types`**
Manual/static types (no connector) are valid. FK is `ON DELETE SET NULL` so deleting a source orphans its types rather than cascade-deleting them — the data type may still be useful.

**No `created_by` on new tables**
`data_sources` and `data_types` are system-managed (created by connectors, not users). Omitting `created_by` keeps it simple; add later if auth is introduced.

## Risks / Trade-offs

- **`ON DELETE SET NULL` vs CASCADE**: Chose SET NULL to preserve registered types when a source is deleted. If a deleted source's types should also disappear, that's a future policy decision in the connector layer.
- **`fields` JSONB as TEXT**: Loses PG indexing on field names. Acceptable now; can migrate to native JSONB later with a small Slick upgrade.
