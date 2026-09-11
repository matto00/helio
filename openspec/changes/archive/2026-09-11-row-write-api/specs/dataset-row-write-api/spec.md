## Purpose
Defines the row-write API for `dataset`-kind sources: append-only writes and full-set atomic
replaces, both validated against the source's declared schema.

## ADDED Requirements

### Requirement: The row-write request body is a positional row array
`POST` and `PUT /api/data-sources/:id/rows` SHALL accept a request body of the shape
`{"rows": [[<cell>, ...], ...]}` — an array of rows, each row itself an array of cell values
positionally aligned to the source's declared column order, matching the shape already used by
`dataset_rows.data` and `DatasetRowValidator`. Validation error row indices in the response SHALL be
relative to this request body's `rows` array (0-based), independent of the source's existing row
count.

#### Scenario: A validation error names the request-relative row index
- **WHEN** the second row (index 1) in a `POST .../rows` request fails schema validation
- **THEN** the error identifies row index 1, regardless of how many rows already exist on the source

### Requirement: Appending rows to a dataset source does not disturb existing rows
`POST /api/data-sources/:id/rows` on a `dataset`-kind source SHALL append the request's rows to the
source's existing `dataset_rows`, leaving every existing row's `id`, `seq`, and `data` unchanged.
Each newly appended row SHALL be assigned a `seq` value strictly greater than every existing row's
`seq` for that source (0-based, continuing from the source's current maximum `seq`), with no two rows
for the same source ever sharing a `seq` value. A `POST .../rows` request with an empty `rows` array
SHALL be rejected with a `400 Bad Request` and SHALL NOT modify the source.

#### Scenario: Appending rows leaves prior rows untouched
- **WHEN** a dataset source with 3 existing rows (`seq` 0, 1, 2) receives `POST .../rows` with 2 new
  rows
- **THEN** the source has 5 rows total, the original 3 rows' `id`/`seq`/`data` are unchanged, and the
  2 new rows have `seq` 3 and 4

#### Scenario: Appending to an empty source starts at seq 0
- **WHEN** a dataset source with zero rows receives `POST .../rows` with 1 new row
- **THEN** the new row has `seq` 0

#### Scenario: Two concurrent appends to the same source both land with no lost rows
- **WHEN** two callers concurrently `POST .../rows` to the same dataset source, each with one row
- **THEN** the source ends with both new rows persisted, each with a distinct `seq`, and neither
  request's row is lost or overwritten

#### Scenario: An empty append request is rejected without modifying the source
- **WHEN** `POST .../rows` is called with `{"rows": []}`
- **THEN** the response is `400 Bad Request` and the source's rows are unchanged

### Requirement: Replacing rows on a dataset source is atomic
`PUT /api/data-sources/:id/rows` on a `dataset`-kind source SHALL validate the full replacement row
set against the source's declared schema and, only if every row is valid, atomically swap the
source's entire row set for the new one (fresh `id`s, 0-based `seq` `0..N-1`) in a single transaction.
If any row fails validation, the write SHALL be rejected in full and the source's existing row set
SHALL remain exactly as it was before the request. A `PUT .../rows` request with an empty `rows` array
is valid and SHALL result in the source having zero rows.

#### Scenario: A valid replacement swaps the full row set
- **WHEN** a dataset source with 5 existing rows receives a valid `PUT .../rows` with 2 new rows
- **THEN** the source ends with exactly those 2 rows (`seq` 0 and 1), and none of the original 5
  remain

#### Scenario: An invalid row in a replacement leaves the prior set intact
- **WHEN** a dataset source with 5 existing rows receives `PUT .../rows` with 3 rows where the last
  row fails schema validation
- **THEN** the request is rejected with a field-level error, and the source still has its original 5
  rows, unchanged

#### Scenario: Replacing with an empty set clears the source
- **WHEN** a dataset source with existing rows receives `PUT .../rows` with `{"rows": []}`
- **THEN** the request succeeds and the source ends with zero rows

### Requirement: Row writes are validated against the source's declared schema
Both `POST` and `PUT` row-write routes SHALL validate every row in the request body against the
target source's declared schema using the same validation contract `dataset-schema-validation`
defines for create/refresh, before any row is persisted.

#### Scenario: An append with a wrong-typed field is rejected
- **WHEN** `POST .../rows` includes a row with a value that does not match its field's declared type
- **THEN** the response is a field-level validation error and no row from the request is persisted

### Requirement: A dataset source's inferred schema stays current after every row write
`POST` and `PUT /api/data-sources/:id/rows` SHALL recompute the source's inferred (runtime) schema
over the full post-write set of rows, exactly as source creation and refresh already do, so a
downstream reader of the inferred schema never observes a value stale relative to the rows actually
stored.

#### Scenario: Appending a differently-typed value updates the inferred schema
- **WHEN** a column's existing rows are all null for a field, and an appended row supplies a numeric
  value for that field
- **THEN** the source's inferred schema for that field reflects the numeric type after the append

### Requirement: Row-write routes are rejected on non-dataset sources
`POST` and `PUT .../rows` on a source whose kind is not `dataset` SHALL be rejected with a `400 Bad
Request` (or equivalent client error), never a `500`, and SHALL NOT modify the source.

#### Scenario: Writing rows to a csv source is rejected cleanly
- **WHEN** a caller calls `POST /api/data-sources/:id/rows` for a `csv`-kind source
- **THEN** the response is a 4xx client error and the source is unchanged

### Requirement: Row-write responses return enough for downstream precondition and display use
A successful `POST` or `PUT .../rows` response SHALL include, for every row affected by the write,
its `id`, `seq`, and `updatedAt`, plus the source's resulting `updatedAt` timestamp.

#### Scenario: Append response includes per-row id, seq, updatedAt, and the source's updatedAt
- **WHEN** `POST .../rows` successfully appends 2 rows
- **THEN** the response includes each new row's `id`, `seq`, and `updatedAt`, and the source's
  `updatedAt`

### Requirement: Row-write requests are bounded by the same row-count limit as source creation
`POST` and `PUT .../rows` SHALL reject a request whose row count (for `PUT`, the full replacement
set; for `POST`, the resulting total row count) would exceed the same maximum row count enforced on
dataset source creation, with a `400 Bad Request` rather than an unbounded write attempt. This check
SHALL be evaluated against the row count as of the moment the write actually applies (i.e. serialized
against other concurrent writers to the same source), not a count read before the write.

#### Scenario: A replacement exceeding the row limit is rejected
- **WHEN** `PUT .../rows` is called with a row count above the configured maximum
- **THEN** the response is a `400 Bad Request` and the source's existing rows are unchanged

#### Scenario: Two concurrent appends cannot jointly exceed the row limit
- **WHEN** two concurrent `POST .../rows` requests each individually keep the source under the row
  limit, but their combined effect would exceed it
- **THEN** at least one of the two requests is rejected with `400 Bad Request`, and the source's final
  row count never exceeds the limit
