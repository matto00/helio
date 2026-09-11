# dataset-row-write-api Specification

## Purpose
Defines the row-write API for `dataset`-kind sources: append-only writes and full-set atomic
replaces, both validated against the source's declared schema.

## Requirements

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

### Requirement: A single row can be replaced with an updatedAt precondition
`PATCH /api/data-sources/:id/rows/:rowId` on a `dataset`-kind source SHALL accept a request body of
the shape `{"updatedAt": "<iso8601>", "data": [<cell>, ...]}`, where `data` is the row's complete new
value: a positional array the same length and column order as the source's declared schema (not a
partial/sparse update — every column's new value is submitted, including columns whose value is
unchanged). The submitted `data` SHALL be validated against the source's currently-declared schema
using the same `DatasetRowValidator` contract append/replace already use, with no merge against the
row's previously-stored value. The write SHALL be applied only if the target row (a) exists under the
source named by `:id` and (b) has a current `updated_at` exactly matching the request's `updatedAt`;
the mutation statement's `WHERE` clause SHALL include the row id, the source id, AND the `updated_at`
value together, so a `rowId` belonging to a different source can never be matched regardless of the
supplied `updatedAt`. On success, the row's `updated_at` SHALL be advanced to the time of the write
(using the same microsecond-truncation convention every existing row writer uses) and the source's
`inferred_schema` SHALL be recomputed over the full post-write row set.

#### Scenario: A precondition-matching edit succeeds and returns the updated row
- **WHEN** `PATCH .../rows/:rowId` is called with the row's current `updatedAt` and a complete new
  `data` array
- **THEN** the response is `200` with the row's `id`, `seq`, advanced `updatedAt`, and the new `data`,
  and the source's `inferred_schema` reflects any changed value

#### Scenario: A stale precondition is rejected without applying the edit
- **WHEN** `PATCH .../rows/:rowId` is called with an `updatedAt` that does not match the row's current
  `updated_at`
- **THEN** the response is `409 Conflict` (naming the row id and both the expected and current
  `updatedAt`) and the row's stored data and `updated_at` are unchanged

#### Scenario: An edit that fails schema validation is rejected before the precondition is checked
- **WHEN** `PATCH .../rows/:rowId` supplies a `data` value that does not match its column's declared
  type, regardless of whether `updatedAt` matches
- **THEN** the response is a field-level `400` validation error and the row is unchanged; a stale
  precondition on an otherwise-invalid payload is never disclosed (validation is checked first)

#### Scenario: Clearing an optional cell with no declared default is a normal full-row edit
- **WHEN** `PATCH .../rows/:rowId`'s `data` array supplies `null` for an optional column that has no
  declared `default` and currently has a non-null value, with every other column carrying its
  intended value
- **THEN** the edit succeeds and that column's stored value becomes `null`

#### Scenario: A null for an optional column with a declared default stores the default, not null
- **WHEN** `PATCH .../rows/:rowId`'s `data` array supplies `null` for an optional column that HAS a
  declared `default`
- **THEN** the edit succeeds and that column's stored value becomes its declared default, per
  `DatasetRowValidator`'s existing null-fills-default behavior (this is not a way to force a `null`
  into a defaulted column)

### Requirement: A single row can be deleted with an updatedAt precondition
`DELETE /api/data-sources/:id/rows/:rowId?updatedAt=<iso8601>` on a `dataset`-kind source SHALL
delete the target row only if (a) it exists under the source named by `:id` and (b) its current
`updated_at` exactly matches the query parameter's value; the conditional delete statement's `WHERE`
clause SHALL include the row id, the source id, AND `updated_at` together, with the same
cross-source-scoping guarantee as `PATCH`. A missing or unparseable `updatedAt` query parameter SHALL
be rejected with `400 Bad Request` before any row lookup. On success, the source's `inferred_schema`
SHALL be recomputed over the remaining rows and the source's `updated_at` SHALL be advanced; the
response SHALL be `204 No Content`.

#### Scenario: A precondition-matching delete removes the row
- **WHEN** `DELETE .../rows/:rowId?updatedAt=...` is called with the row's current `updatedAt`
- **THEN** the response is `204`, the row no longer exists, and the source's `inferred_schema` is
  recomputed over the remaining rows

#### Scenario: A stale precondition is rejected without deleting the row
- **WHEN** `DELETE .../rows/:rowId?updatedAt=...` is called with an `updatedAt` that does not match
  the row's current `updated_at`
- **THEN** the response is `409 Conflict` and the row still exists, unchanged

#### Scenario: Deleting an already-deleted, nonexistent, or cross-source row returns not-found
- **WHEN** `DELETE` (or `PATCH`) is called for a `rowId` that does not exist under the source named by
  `:id` — already deleted, never existed, or belongs to a different source (including one owned by
  the same caller)
- **THEN** the response is `404 Not Found`, using the same not-found shape as other ACL-scoped
  lookups on this route family, and (for the cross-source case) the other source's row is unaffected

### Requirement: Row edit/delete routes enforce the same ACL and kind checks as row write, in a fixed
order
`PATCH` and `DELETE /api/data-sources/:id/rows/:rowId` SHALL apply checks in this order: (1) a
malformed/missing `updatedAt` is `400`, before any database lookup; (2) the source must exist and be
owned by the caller (`404` otherwise, RLS-enforced, never `403`); (3) the source's kind must be
`dataset` (`400` otherwise); (4) the target row must exist under this source (`404` otherwise); (5)
for `PATCH`, the submitted row must pass schema validation (`400` otherwise); (6) the precondition
must match (`409` otherwise). A request for a source or row owned by a different user SHALL receive
the same not-found shape as an ACL-scoped lookup elsewhere in this route family — never a
distinguishable "exists but not yours" response.

#### Scenario: Editing a row owned by another user returns not-found, not forbidden
- **WHEN** a caller calls `PATCH .../rows/:rowId` for a row belonging to a source owned by a
  different user
- **THEN** the response is `404 Not Found` (RLS-enforced), not `403 Forbidden`, and no row data is
  disclosed

#### Scenario: A non-dataset source rejects edit/delete cleanly
- **WHEN** `PATCH` or `DELETE .../rows/:rowId` is called for a source whose kind is not `dataset`
- **THEN** the response is `400 Bad Request` and the source/row are unchanged

### Requirement: A dataset source's rows can be listed with identity, paged by seq
`GET /api/data-sources/:id/rows` on a `dataset`-kind source SHALL return a page of the source's
rows ordered by `seq` ascending, each row including its `id`, `seq`, `data` (the positional cell
array), and `updatedAt`, plus the total row count for the source and enough paging information
(a `seq`-based cursor) for the caller to request the next page. The number of rows returned in a
single response SHALL never exceed a fixed page-size cap, regardless of the source's total row
count — a source with 10,000 rows SHALL require multiple requests to read in full, never one
unbounded response.

#### Scenario: A page of rows is returned in seq order with identity fields
- **WHEN** `GET /api/data-sources/:id/rows` is called on a dataset source with existing rows
- **THEN** the response includes a page of rows ordered by ascending `seq`, each with `id`, `seq`,
  `data`, and `updatedAt`, and the response also carries the source's total row count

#### Scenario: A 10k-row dataset is never returned in one response
- **WHEN** `GET /api/data-sources/:id/rows` is called on a dataset source with 10,000 rows, with no
  page-size override or with an override above the cap
- **THEN** the response contains at most the page-size cap's number of rows, and paging information
  is present to retrieve the remainder

#### Scenario: Paging through appended rows never skips or duplicates a row already seen
- **WHEN** a caller pages through a dataset source's rows using the cursor this endpoint returns,
  and new rows are appended to the source (via `POST .../rows`) between page requests
- **THEN** every row that existed at the start of paging is returned exactly once across the pages
  fetched, in ascending `seq` order, regardless of the concurrent append

#### Scenario: A page cursor of seq 0 is a valid cursor for the next request
- **WHEN** a page ends with a row whose `seq` is `0` (e.g. a one-row-per-page request against a
  source starting at `seq` 0) and the response's `nextCursor` is `0`
- **THEN** a subsequent request with `cursor=0` succeeds and returns rows with `seq > 0`, never a
  `400`

#### Scenario: nextCursor is absent, never null, at the end of the row set
- **WHEN** a page request returns every remaining row for a source (no further rows exist beyond
  this page)
- **THEN** the response's `nextCursor` field is absent from the JSON body entirely — never present
  with a `null` value

#### Scenario: A concurrent full replace during paging is not required to preserve cursor validity
- **WHEN** a caller is paging through a dataset source's rows and, between two page requests, the
  entire row set is replaced (`PUT .../rows` or a CSV refresh)
- **THEN** this endpoint is not required to return the pre-replace rows the caller had not yet
  fetched, or to guarantee the caller's outstanding cursor still refers to a meaningful position —
  only concurrent single-row appends and deletes are covered by the no-skip/no-duplicate guarantee

### Requirement: Row listing returns the same 404/400 shape as other row routes for ACL and kind
`GET /api/data-sources/:id/rows` SHALL apply the same ACL-scoped source lookup as the existing
`POST`/`PUT`/`PATCH`/`DELETE .../rows` routes: an unauthorized or nonexistent source SHALL return the
same not-found shape (HEL-1002 convention), and a source whose kind is not `dataset` SHALL be
rejected with a `400 Bad Request`, never a `500`.

#### Scenario: Listing rows for a nonexistent or unauthorized source returns not-found
- **WHEN** `GET /api/data-sources/:id/rows` is called for a source id that does not exist, or exists
  but is not owned by the caller
- **THEN** the response is `404 Not Found`, using the same shape as other ACL-scoped lookups on this
  route family

#### Scenario: Listing rows on a non-dataset source is rejected cleanly
- **WHEN** `GET /api/data-sources/:id/rows` is called for a `csv`-kind source
- **THEN** the response is a `400 Bad Request`, not a `500`, and no rows are returned

### Requirement: Row listing runs under the caller's own RLS-scoped database context
`GET /api/data-sources/:id/rows` SHALL read `dataset_rows` under the requesting caller's own
row-level-security-scoped database context, never the privileged/system database pool used
internally by `readDatasetRows` for the pipeline engine, Spark submitter, and preview call sites.
Access to another owner's rows SHALL be denied by Postgres row-level security itself, not solely by
an application-level ownership check.

#### Scenario: A non-superuser, non-BYPASSRLS role cannot read another owner's rows through this route
- **WHEN** `GET /api/data-sources/:id/rows` is called by an authenticated caller for a source id
  owned by a different user, using a database role that is not a superuser and does not have
  `BYPASSRLS`
- **THEN** the response is the same not-found shape as any other unauthorized/nonexistent source
  (the request never reaches `dataset_rows` in this path — the source-level ACL/existence check
  rejects it first); AND, independently, a direct read of `dataset_rows` for that source id under the
  same non-superuser, non-BYPASSRLS role and a different owner is itself denied by the
  `dataset_rows_owner` row-level security policy (V106), never solely by an application-level owner
  filter — see the `row-listing-api` change's design.md (D7) and its RLS test task (tasks.md 4.4)
  for how both layers are verified independently

### Requirement: Row listing does not modify readDatasetRows or its existing callers
`GET /api/data-sources/:id/rows` SHALL be implemented as a new, additive read path. It SHALL NOT
change `readDatasetRows`'s method signature, response shape, or the behavior of any of its existing
callers (the in-process pipeline engine, the Spark job submitter, and dataset preview).

#### Scenario: Existing readDatasetRows consumers are unaffected
- **WHEN** the pipeline engine, Spark submitter, or preview code path reads a dataset source's rows
  after this change ships
- **THEN** they continue to receive exactly the `{columns, rows}` shape `readDatasetRows` already
  returned before this change, unchanged
