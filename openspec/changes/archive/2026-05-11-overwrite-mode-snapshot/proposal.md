## Why

Pipeline runs currently update the DataType schema (field names) but discard the actual output rows. There is no way to read what a pipeline last produced — the data evaporates after the HTTP response. Overwrite mode closes this gap: a successful run atomically replaces the DataType's row snapshot, making the live data queryable by panels.

## What Changes

- New `data_type_rows` table (Flyway V29) storing JSONB rows keyed by `(data_type_id, row_index)`.
- Non-dry pipeline runs now write output rows to `data_type_rows` atomically (DELETE old + INSERT new in one transaction) after execution succeeds.
- Improved field-type inference: values are inspected at runtime to emit `integer`, `double`, or `boolean` types instead of always `string`.
- New `GET /api/data-types/:id/rows` endpoint returns the stored snapshot as `{ rows: [...], rowCount: N }`.
- Frontend run success message distinguishes live runs ("Snapshot replaced: N rows") from dry runs ("Preview: N rows").
- Dry runs continue to NOT write to `data_type_rows`.

## Capabilities

### New Capabilities

- `datatype-row-snapshot`: Persistence and retrieval of DataType row snapshots written by pipeline runs.

### Modified Capabilities

- `pipeline-run-execution`: Non-dry run now atomically writes rows to `data_type_rows`; improved field-type inference; success message updated.
- `datatype-crud-api`: New `GET /api/data-types/:id/rows` endpoint added.

## Impact

- **Backend**: New Flyway migration, new `DataTypeRowRepository`, updated `PipelineRunRoutes`, updated `DataTypeRoutes`, updated `ApiRoutes` wiring.
- **Frontend**: `pipelinesSlice` success toast wording; `pipelineService` unchanged (same endpoint).
- **Schema**: One new table; no breaking changes to existing columns.

## Non-goals

- Append mode and merge mode (future tickets).
- Pagination of `/rows` endpoint (return all rows for MVP).
- Panel binding to snapshot rows (separate ticket).
