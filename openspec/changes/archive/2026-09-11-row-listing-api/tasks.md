## 1. Backend: repository + service

- [x] 1.1 Add `DataSourceRepository.listRows(sourceId, cursor: Option[Long], limit: Int, user)`:
  RLS-scoped (`ctx.withUserContext`), fetches `limit + 1` rows via `WHERE data_source_id = ? [AND
  seq > ?] ORDER BY seq ASC LIMIT (limit + 1)` against the existing `(data_source_id, seq)` index,
  trims to `limit` and derives `nextCursor` (design.md D1/D2). The source-existence check reads
  `datasetSchema` via the SAME `table.filter(_.id === sourceId.value).map(_.datasetSchema)
  .result.headOption` pattern `patchRow`/`deleteRow` already use — `None` means `SourceNotFound`
  regardless of whether the source truly doesn't exist or RLS is hiding another owner's source; this
  is intentional, existing ambiguity-by-design (design.md D7), not a new gap to resolve. The page
  query and the `total` count run in ONE `DBIO`/transaction (design.md D7) — no `lockSource`.
- [x] 1.2 Add `DataSourceService.listRows(sourceId, cursor, limit, user)`: ACL-scoped lookup → 404;
  kind check (`dataset` only) → 400; delegate to repository; enforce `limit` clamp to
  `Page.MaxLimit` (500) and default 200 when absent (design.md D3); `cursor`, if present, must be
  a non-negative integer (`0` is valid — design.md D2 CR1); reject malformed `cursor`/`limit` with
  400 before any DB call (design.md D6).
- [x] 1.3 Add a page-response type in `DataSourceProtocol.scala` wrapping the EXISTING
  `RowResponseRow` type (`DataSourceProtocol.scala:282` — do NOT invent a new per-row type,
  design.md D4): `{rows: Vector[RowResponseRow], nextCursor: Option[Long], total: Int}`. Confirm
  `nextCursor: Option[Long]` serializes as absent-when-`None` (spray-json default `Option`
  behavior), never `null`.

## 2. Backend: route + wiring

- [x] 2.1 Add `GET /api/data-sources/:id/rows` in `DataSourceRoutes.scala`, composed alongside the
  existing `POST`/`PUT` on the same path (same rate-limit/auth wrapping as siblings).
- [x] 2.2 Verify precedence order matches design.md D6 exactly (malformed query param → source ACL →
  kind → success).

## 3. Contract

- [x] 3.1 Add a new `schemas/sources/row-list-response.schema.json`: `{rows: RowResponseRow[],
  nextCursor?: integer, total: integer}` — `$ref` the EXISTING `schemas/sources/row-response-row
  .schema.json` for each row item (do not duplicate its fields); `nextCursor` NOT in `required`,
  modeling it as genuinely optional/absent (MISTAKES.md: spray-json omits `Option = None`, never
  emits `null`).
- [x] 3.2 There is no OpenAPI file in this repo (verified: `find . -iname 'openapi*.y*ml'` finds
  none) — this repo's "contract" for a route is `schemas/` + `frontend/src` service types only (see
  HEL-1078/PR #637's own diff for precedent). Skip an OpenAPI-file task; do not create one.
- [x] 3.3 Update `frontend/src/features/sources/types/dataSource.ts` (the exact file HEL-1078 added
  its `RowResponseRow`/`RowResponse` types to) with the new list-response TS type, plus a service
  function for `GET /api/data-sources/:id/rows` (no UI consumer yet — HEL-1080 is the consumer; this
  ticket only adds the typed service call).

## 4. Tests — backend (ScalaTest)

- [x] 4.1 Repository/service unit tests: paging (empty source, single page, multi-page,
  `nextCursor` absent from the JSON on the last page — never `null`), `limit` clamp to 500, default
  200, malformed `cursor`/`limit` → 400.
- [x] 4.2 ACL test: nonexistent source id → 404 (HEL-1002 shape); another owner's source → 404
  (same shape, not 403).
- [x] 4.3 Wrong-kind test: `csv`-kind source → 400, not 500.
- [x] 4.4 **RLS test (AC #2, MUST)**: in `RlsOwnerTablesSpec`'s existing two-role (non-superuser,
  non-BYPASSRLS `helio_app_test`) fixture pattern, add a `dataset_rows`/`listRows` case with these
  PINNED expected outcomes (not just "denies access"):
  - (a) Calling `DataSourceRepository.listRows` DIRECTLY (bypassing the service's `findByIdOwned`
    application-level filter — see design.md D7) as a NON-OWNER, under the non-BYPASSRLS test role,
    against a source owned by a different user: because `data_sources` itself has FORCE RLS, the
    repository's own `datasetSchema` existence read (D7) already returns nothing for a source RLS
    hides — the expected, pinned result is `SourceNotFound`, exactly like calling `patchRow`/
    `deleteRow` as a non-owner. This does NOT by itself exercise the `dataset_rows` table's own RLS
    policy (the query never reaches `dataset_rows` at all in this case) — see (c) below for the test
    that actually does.
  - (b) A positive control: the OWNER, under the SAME non-BYPASSRLS role, successfully lists the
    rows via `listRows`.
  - (c) The test that actually exercises `dataset_rows`'s own RLS policy: a RAW `SELECT * FROM
    dataset_rows WHERE data_source_id = ?` executed directly (not via `listRows`) as the non-owner,
    under the non-BYPASSRLS role, against a source owned by a different user — pinned to return ZERO
    rows — contrasted with the SAME raw query executed via the privileged pool
    (`ctx.withSystemContext`), pinned to return the actual rows. This is what proves the
    `dataset_rows_owner` RLS policy (V106), not just an application-level `owner_id` filter, is doing
    the denying.
  - (d) Assert `listRows`'s own SQL has no additional `owner_id`/ACL predicate of its own beyond
    `data_source_id = ?` — RLS, not application code, is what enforces the boundary at this layer.
- [x] 4.5 **Round-trip test (AC #3, MUST)**: `POST`/`PUT` a row, then `GET .../rows`, take the
  returned row's `updatedAt` EXACTLY as it appears in the JSON response body (not the raw DB
  `Instant`), then `PATCH .../rows/:rowId` with that exact string value; assert `200`, not `409`.
- [x] 4.6 **Paging-stability-under-concurrent-append test (AC #1, MUST)**: start paging a source
  with N rows, append M more rows between page fetches, assert every one of the original N rows is
  returned exactly once across all pages fetched, in ascending `seq` order, with no duplicate and no
  skip.
- [x] 4.7 **No-regression test (AC #4, MUST)**: existing `readDatasetRows`-consumer tests (pipeline
  engine / preview / Spark submitter fixtures, whichever already exist) still pass unmodified; add
  an explicit assertion that `readDatasetRows`'s own return shape (`{columns, rows}`, raw cells) is
  unchanged.
- [x] 4.8 spray-json `Option`-absent test (AC #5): assert `nextCursor` is genuinely ABSENT (key not
  present) from the serialized JSON when there are no more rows, not present with a `null` value —
  parse the raw JSON string/`JsObject` and check `.fields.contains("nextCursor")` is `false`, not
  merely that a deserialized case class field is `None` (deserializing back to Scala would mask a
  `null`-emission bug, since both `null` and absent parse to `None` on the way back in).
- [x] 4.9 Cursor-boundary test (design.md D2): a page ending with exactly `limit` rows AND no further
  rows existing returns no `nextCursor`; a page ending with exactly `limit` rows AND at least one
  further row existing returns a `nextCursor` that successfully retrieves the remainder. Also test
  `cursor=0` is accepted and returns rows with `seq > 0` (design.md D2 CR1).

## 5. Frontend

- [x] 5.1 Service function + TypeScript types for `GET /api/data-sources/:id/rows` (cursor/limit
  params in, `{rows, nextCursor, total}` out), matching the schema from 3.1.

## 6. Verification

- [x] 6.1 Manual/dev-server check: create a dataset source with rows, call the new endpoint via
  curl/httpie, confirm shape and paging behave as designed.
- [x] 6.2 Confirm no migration was needed (existing `idx_dataset_rows_data_source_id` index is
  sufficient) — if this determination changes during implementation, STOP and raise an ESCALATION
  to the orchestrator/human before creating a new migration file.

## 7. Delivery follow-up

- [ ] 7.1 At Delivery, raise (non-blocking, informational to the driver) that no existing route
  exposes a dataset source's DECLARED schema (`DatasetFieldDeclaration`) — only `inferredSchema` is
  ever returned, and there is no `GET /api/data-sources/:id` at all (design.md D5). HEL-1080's grid
  will need this. File a standalone follow-up ticket (same precedent HEL-1078 set in filing this
  ticket) rather than solving it here.

## Standing Constraints
