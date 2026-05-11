# HEL-198 — Overwrite mode: full DataType snapshot replacement

## Title
Overwrite mode: full DataType snapshot replacement

## Description
Default run mode. On successful execution, fully replaces the current DataType snapshot with the new pipeline output. Atomic: the old snapshot is not removed until the new one is ready. Updates the DataType's schema if field names or types changed.

## Context (from investigation)

### Current state after HEL-196 + HEL-197

- `POST /api/pipelines/:id/run` (non-dry) executes pipeline steps in-process.
- On success it calls `upsertFieldsFromRows` which updates the DataType's `fields` (schema) and bumps `version`. This is already wired.
- It does NOT persist the actual row data anywhere — there is no `data_type_rows` table and no snapshot storage at all.
- The run records a `pipeline_runs` row with `status="succeeded"` and `row_count`.
- The `pipeline-run-execution` spec already contains a requirement: "Successful non-dry run writes schema snapshot to Type Registry" — schema update is implemented. Row storage is NOT.

### What this ticket adds

1. **`data_type_rows` table** — a new Flyway migration (V29) creating a table to store per-row JSONB snapshots keyed by `(data_type_id, row_index)` (or an auto-id with ordering).
2. **Overwrite persistence** — after a successful non-dry run, `DELETE FROM data_type_rows WHERE data_type_id = ?` followed by bulk `INSERT` of the new rows. This is atomic within a transaction.
3. **Schema update already done** — `upsertFieldsFromRows` already updates `fields` + `version`; field type inference should be improved (detect integer, double, boolean from actual values, not always "string").
4. **Read endpoint** — `GET /api/data-types/:id/rows` returns the stored snapshot rows (pagination optional for MVP; return all rows for now).
5. **Frontend success message** — the run success toast/message should reflect "Snapshot replaced: N rows written" for non-dry runs.
6. **No mode selector needed** — "overwrite" is the only commit mode. No UI mode toggle required.

## Acceptance Criteria

1. After a successful non-dry run, `data_type_rows` contains exactly the pipeline output rows for the DataType — previous rows are fully replaced (overwrite/atomic swap).
2. The DataType's `fields` schema and `version` are updated to reflect the run output (already partially implemented; field type inference should be improved).
3. `GET /api/data-types/:id/rows` returns the stored rows as `{ rows: [...], rowCount: N }`.
4. A dry run must NOT write to `data_type_rows`.
5. If the pipeline produces 0 rows, `data_type_rows` for that DataType is cleared (DELETE without INSERT).
6. The frontend run success message distinguishes dry-run ("Preview: N rows") from live run ("Snapshot replaced: N rows").
7. Backend: unit tests for the overwrite path (insert, then overwrite with different rows, verify old rows gone).
8. Backend: `GET /api/data-types/:id/rows` route test.
