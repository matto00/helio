## Why

`static` sources store rows as a single JSONB blob in `data_sources.config`, which has no row identity
and forces a whole-blob read-modify-write on every edit. v0.8's dataset primitive (HEL-1075) needs
per-row addressing and safe concurrent appends. This ticket is v0.8's foundation migration ("Migration A"),
widened by owner ruling (2026-09-11, recorded on HEL-1074) to the full bundle the spec and HEL-1075's
design.md describe together, since no other ticket in the epic owns it.

## What Changes

- New `dataset_rows(id, data_source_id, seq, data jsonb, created_at, updated_at)` table with forced RLS
  through `data_source_id → data_sources.owner_id`.
- Backfill `dataset_rows` from each `static`-kind source's `data_sources.config` blob.
- **BREAKING (internal only):** swap `InProcessPipelineEngine`, `SparkJobSubmitter`, and
  `DataSourceService.previewStatic` off `readRawConfig`/`parseStaticPayload` onto `dataset_rows` reads.
- Drop/re-add the `source_type` CHECK constraint (`dataset` replacing `static`), then
  `UPDATE data_sources SET source_type = 'dataset' WHERE source_type = 'static'` (constraint drop must
  precede the UPDATE).
- New nullable `dataset_schema jsonb` on `data_sources`, backfilled from each migrated source's
  **declared** `config->'columns'` (not its runtime-inferred schema, which can disagree with the
  declared type).
- Decided and documented in design.md: (a) `data_sources.config` is cleared for migrated rows once
  backfill is content-parity-verified, (b) the two `updateStaticPayload` write call sites
  (`createStatic`/`refreshStatic`) are retargeted to write `dataset_rows` atomically in this same
  change.
- Correct the stale `StaticSource` scaladoc in `DataSource.scala`.

## Capabilities

### New Capabilities
- `dataset-row-storage`: the `dataset_rows` table, its forced RLS policy, and the repository read path
  that replaces `readRawConfig`/`parseStaticPayload` for dataset-kind sources.

### Modified Capabilities
- `static-data-connector`: `source_type` becomes `dataset`; row storage moves from `data_sources.config`
  to `dataset_rows`; preview reads from the new table.
- `data-source-persistence`: `data_sources.source_type` CHECK constraint accepts `dataset` in place of
  `static`; new nullable `dataset_schema` column.

## Non-goals

- The row write API (`POST`/`PUT`/`PATCH`/`DELETE` on rows) — HEL-1077/1078.
- The `dataset` domain-model ADT member / connector registration / `"static"` wire alias — HEL-1073.
- Dataset management UI — HEL-1080.

## Impact

Backend only: one Flyway migration, `DataSourceRepository`, `InProcessPipelineEngine`,
`SparkJobSubmitter`, `DataSourceService`, `DataSource.scala` scaladoc. No frontend or API-contract change
(`kind`/`type` on the wire is unaffected by this ticket — HEL-1073 owns the wire alias).
