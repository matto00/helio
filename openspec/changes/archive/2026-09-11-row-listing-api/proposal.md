## Why

HEL-1078 shipped per-row `PATCH`/`DELETE` with an `updatedAt` precondition, but there is still no way
to read a dataset's rows with their identity (`id`, `seq`, `updatedAt`) — `readDatasetRows` returns
only raw cells. HEL-1080's grid cannot drive HEL-1078's precondition header without this.

## What Changes

- Add `GET /api/data-sources/:id/rows` — returns a page of dataset rows with `id`, `seq`, `data`,
  `updatedAt`, ordered by `seq`, plus a total row count and a page-size-capped cursor/offset. Never
  returns more than the page-size cap in one response, regardless of dataset size.
- Reuses the existing ACL-scoped source lookup (404 for unauthorized/nonexistent, same HEL-1002
  shape), the `dataset`-kind check (400 for wrong kind), and runs under the caller's own RLS-scoped
  DB context — not the privileged/system pool `readDatasetRows` uses internally for the pipeline
  engine/Spark/preview call sites.
- Does not modify `readDatasetRows`, its callers, or its response shape in any way — this is a new,
  additive read path.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `dataset-row-write-api`: adds a paged `GET` listing requirement (row identity, paging, ACL, RLS
  scoping) alongside the existing append/replace/patch/delete requirements. (Kept in this capability
  rather than a new one — it is the same route family and the same underlying `dataset_rows`
  resource; splitting the read side into its own capability would fragment one resource's contract
  across two spec files for no reader benefit.)

## Non-goals

- Bulk export or unbounded dump of a dataset's rows.
- Filtering/searching rows by cell value (HEL-1080 grid work, if needed, is separate).
- Any change to `readDatasetRows`, the pipeline engine, Spark submitter, or preview code paths.

## Impact

- `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` — new GET route.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — new `listRows` method.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` —
  new paged, RLS-scoped read query (NOT `readDatasetRows`, NOT `ctx.withSystemContext`).
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — new response
  type(s).
- `schemas/`, `frontend/src` service types — same PR. (No OpenAPI file exists in this repo — verified
  by search; this repo's route contract is `schemas/` + `frontend/src` types, per HEL-1078's own
  precedent.)
