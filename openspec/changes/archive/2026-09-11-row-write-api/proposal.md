## Why

`dataset` sources (HEL-1073/1074) have a declared schema (HEL-1076) and a row store (`dataset_rows`),
but no write path except the source wizard's create/refresh call. v0.8's write→run→refresh loop (form
panels, counters, `upsert_source`) needs a standalone row-write API: append without disturbing existing
rows, and atomic full-set replace — both schema-validated and ACL-enforced like every other resource.

## What Changes

- Add `POST /api/data-sources/:id/rows` (append) and `PUT /api/data-sources/:id/rows` (replace) to
  `DataSourceRoutes`, `dataset`-kind sources only.
- Both validate the request body against the source's declared schema via the existing
  `DatasetRowValidator` (HEL-1076) — reused, not reimplemented.
- Append assigns each new row a strictly increasing, 0-based `seq` (per source, continuing from the
  source's current max) with no lost rows or duplicate `seq` under concurrent callers, including
  against the existing refresh path; existing rows are untouched.
- Replace swaps the entire row set in one transaction (via the restructured `replaceRows` repository
  method, shared with the existing refresh path): any row's validation failure leaves the prior set
  intact, no partial writes.
- Both writes recompute the source's inferred (runtime) schema over the full post-write row set, kept
  in sync exactly as create/refresh already do.
- Non-`dataset` sources (csv/sql/rest/etc.) reject the new routes with a clean 4xx, not a 500.
- Unauthorized/non-owner callers get the same 404 shape `data-source-acl` already uses elsewhere — no
  existence leak (HEL-1002).
- Response body returns enough for downstream consumers (HEL-1078's precondition, HEL-1080's grid):
  per-row `id`, `seq`, and the source's `updatedAt`.
- `schemas/`, the OpenAPI spec, and the frontend `DataSource` service types gain the new routes'
  request/response shapes in this same change.

## Capabilities

### New Capabilities
- `dataset-row-write-api`: append/replace row-write endpoints for `dataset` sources — validation,
  atomicity, concurrency-safe `seq` assignment, response shape, and non-dataset rejection.

### Modified Capabilities
- `data-source-acl`: extend ownership enforcement (404-on-non-owner, no existence leak) to the two new
  row-write routes.

## Non-goals

- Per-row `PATCH`/`DELETE` (HEL-1078).
- Auto-running downstream pipelines on write (HEL-1091 epic).
- Request-level rate limiting policy changes — the existing `RATE_LIMIT_*` directive is verified to
  already cover these routes as siblings, not modified.

## Impact

- Backend: `DataSourceRoutes.scala`, `DataSourceService.scala` (new append/replace methods reusing
  `DatasetRowValidator`), `DataSourceRepository.scala` (row insert/replace against `dataset_rows`),
  request-size/row-count limits.
- Schemas/OpenAPI: new request/response shapes for both routes.
- Frontend: `dataSourceService` (or equivalent) gains typed calls for the new routes (no UI consumer in
  this ticket — HEL-1080 is downstream).
