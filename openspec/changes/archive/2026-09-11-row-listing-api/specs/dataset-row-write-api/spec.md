## ADDED Requirements

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
