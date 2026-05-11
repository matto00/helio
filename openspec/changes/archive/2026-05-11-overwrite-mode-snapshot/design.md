## Context

Pipeline runs execute in-process and return rows as HTTP responses (see `PipelineRunRoutes.scala`). HEL-196/197 added run recording and dry-run. The non-dry path already calls `upsertFieldsFromRows` to update the DataType schema but discards actual row values — there is no persistence layer for row data.

`DataTypeRepository` stores the DataType record (schema, version, metadata) in the `data_types` table. Row data needs a separate table because cardinality is unbounded and belongs to the run-time data plane, not the schema plane.

## Goals / Non-Goals

**Goals:**
- Persist pipeline output rows to `data_type_rows` after every successful non-dry run (overwrite semantics).
- Improve field-type inference so numeric and boolean values emit correct types, not always `"string"`.
- Expose `GET /api/data-types/:id/rows` for downstream consumers.
- Update frontend success message to say "Snapshot replaced: N rows".

**Non-Goals:**
- Append / merge run modes (future).
- Pagination of `/rows` (all rows returned for MVP).
- Panel binding to snapshot rows (separate ticket).
- Spark-path row persistence (in-process engine only for now).

## Decisions

### D1: Table design — `data_type_rows`
Columns: `id BIGSERIAL PK`, `data_type_id TEXT NOT NULL`, `row_index INT NOT NULL`, `data JSONB NOT NULL`.
Unique constraint on `(data_type_id, row_index)`. Index on `data_type_id` for bulk delete + select.
Rationale: JSONB avoids schema coupling; `row_index` preserves insertion order without relying on PK ordering.

### D2: Atomicity — DELETE + INSERT in a single transaction
On success: `DELETE FROM data_type_rows WHERE data_type_id = ?` followed by bulk `INSERT`. Both run in a `transactionally` Slick block. If INSERT fails, DELETE is rolled back — the old snapshot survives.
Rationale: Matches the ticket's "atomic" requirement. Simpler than a staging table approach for MVP row counts.

### D3: Field-type inference improvement
Inspect the first row's values (already done via `rows.headOption`) and apply: `Boolean → "boolean"`, `Int/Long → "integer"`, `Float/Double → "double"`, otherwise `"string"`. This replaces the hardcoded `"string"` in `upsertFieldsFromRows`.

### D4: New `DataTypeRowRepository`
Separate repository class (mirrors `PipelineRunRepository` pattern). Injected into `PipelineRunRoutes` and new `DataTypeRoutes` sub-route.
Rationale: Keeps `DataTypeRepository` focused on the schema record; row storage is a distinct concern.

### D5: Route placement for `GET /api/data-types/:id/rows`
Added to the existing `DataTypeRoutes` (or a new sub-route in `ApiRoutes`). Follows the pattern of `PipelineRunRoutes` being a separate class composed in `ApiRoutes`.

## Risks / Trade-offs

- [Large snapshots] Bulk JSONB insert can be slow for very wide/tall datasets → Mitigation: acceptable for MVP in-process engine scale; Spark path will need its own persistence strategy.
- [DELETE before INSERT window] If the process crashes mid-transaction, old rows survive (correct behaviour). If INSERT partially fails, Slick's `transactionally` rolls back the DELETE → no data loss.

## Migration Plan

1. V29 Flyway migration creates `data_type_rows`.
2. Existing non-dry runs start writing rows immediately on deploy; no backfill needed.
3. Rollback: drop V29 migration and revert route/repo code — existing `data_types` table is unchanged.

## Planner Notes

Self-approved. No breaking API changes, no new external dependencies, no architectural surprises — this extends the existing in-process run path following established patterns.
