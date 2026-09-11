## 1. Repository layer

- [x] 1.1 Add `DataSourceRepository.lockSource(id): DBIO[Unit]` (`SELECT id FROM data_sources WHERE
      id = ? FOR UPDATE`, RLS-scoped under the caller's user context).
- [x] 1.2 Add `appendRows(sourceId, newRows, user)`: one `ctx.withUserContext(...).transactionally`
      action that (a) `lockSource`s the source, (b) reads current `dataset_schema`, existing row
      count, `MAX(seq)`, and every existing row's `data` (needed for inferred-schema recompute), all
      inside the lock, (c) re-validates `newRows` against the freshly-read schema via
      `DatasetRowValidator.validate`, (d) checks `existingCount + newRows.size <= staticMaxRows`,
      (e) inserts the new rows with 0-based `seq` continuing from `MAX(seq) + 1`, (f) recomputes
      `inferred_schema` over the full post-write cell set via `PipelineRowJson.staticColumnRuntimeType`
      and persists it alongside `updated_at`, all in the same transaction. Fail (roll back) on any
      validation/count failure — no partial insert.
- [x] 1.3 Restructure `replaceDatasetRows` (L359) into `replaceRows(id, declaration: Option[Vector[
      DatasetFieldDeclaration]], rows: Vector[Vector[JsValue]], updatedAt, user):
      Future[Option[(DataSource, Vector[DatasetRowRow])]]` — `declaration = Some(...)` for refresh
      (write this schema), `declaration = None` for PUT (read the current schema under the lock,
      leave it unchanged). Move `lockSource`, the effective-schema resolution, `DatasetRowValidator
      .validate`, the delete-then-insert, and an `inferred_schema` recompute (same
      `PipelineRowJson.staticColumnRuntimeType` computation as 1.2) all inside this
      one method's transaction — a failing validation rolls the whole transaction back, whether
      triggered by refresh or by PUT. Return the persisted `DatasetRowRow`s (not discarded) so callers
      can build the response DTO (2.3) without a second read.
- [x] 1.4 Update `applyStaticRefresh`'s call site to call `replaceRows(..., declaration =
      Some(declaredColumns), ...)` and remove its now-redundant pre-call validation (validation moved
      into 1.3, avoiding validating twice against two different possibly-inconsistent reads). `PUT
      /rows` calls `replaceRows(..., declaration = None, ...)`.

## 2. Service layer

- [x] 2.1 Add `DataSourceService.appendRows(id, rows, user)` / `replaceRows(id, rows, user)`: resolve
      + ACL-check the source (404 shape identical to existing non-owner/nonexistent paths), reject
      non-`dataset` kind with `BadRequest` (this check runs before acquiring any lock — no write is
      attempted for the wrong kind). All schema validation and row-count enforcement happens *inside*
      the repository's locked transaction (1.2/1.3), not beforehand in the service, so a concurrent
      schema/row-count change can't race the check.
- [x] 2.2 Reject `POST .../rows` with an empty `rows` array as `400 Bad Request` ("at least one row is
      required"). Accept `PUT .../rows` with an empty `rows` array as a valid "clear all rows" request.
- [x] 2.3 Response DTO: `{rows: [{id, seq, updatedAt}], updatedAt}` (per-row `updatedAt`, not just
      `seq`/`id` — HEL-1078's precondition binds to the row's `updated_at`); add `spray-json`
      formatters in `JsonProtocols.scala`.

## 3. Routes

- [x] 3.1 Add `POST /api/data-sources/:id/rows` and `PUT /api/data-sources/:id/rows` to
      `DataSourceRoutes`, wired the same way sibling per-id routes already are (inherits rate-limit +
      auth from `ApiRoutes` composition — verify with a route test, not by inspection alone). Request
      body shape: `{"rows": [[<cell>, ...], ...]}` (positional arrays, matching `DatasetRowValidator`
      and `dataset_rows.data`'s existing shape — never object-keyed).

## 4. Contract artifacts

- [x] 4.1 Update `schemas/` with the new request/response JSON Schemas (positional-array request,
      per-row `id`/`seq`/`updatedAt` response).
- [x] 4.2 Update the OpenAPI spec (`openspec/`) with both new routes.
- [x] 4.3 Add typed frontend service calls for both routes (no UI consumer yet — HEL-1080 is
      downstream); normalize any `Option`/absent-field wire quirks at the boundary.

## 5. Tests

- [x] 5.1 Unit: append preserves existing rows, assigns 0-based, increasing, non-colliding `seq`
      continuing from the source's current `MAX(seq)`.
- [x] 5.2 Concurrency: a real concurrent test (parallel `Future`s / threads issuing two simultaneous
      appends to the same source) — both land, no lost row, no duplicate `seq`. Not a sequential
      stand-in.
- [x] 5.3 Concurrency: a refresh (`applyStaticRefresh`) racing a concurrent append to the same source
      — both complete without a `UNIQUE(data_source_id, seq)` violation, and the final row set
      reflects one consistent, serialized ordering of the two writes (whichever transaction's lock
      is granted second sees the other's committed effect).
- [x] 5.3b Concurrency: a `PUT .../rows` racing a refresh that changes the declared schema — assert
      the loser of the lock race observes the winner's committed schema (never a stale pre-lock read),
      and neither write is silently lost or reverted by the other (skeptic-design-2.md's required
      revision).
- [x] 5.4 Replace: valid replace swaps the full set; a mid-batch invalid row leaves the prior set
      byte-for-byte intact (query rows after the rejected request and assert equality with the
      pre-request set). A `PUT` with `rows: []` clears the source to zero rows. A `POST` with
      `rows: []` is rejected `400` with no mutation.
- [x] 5.5 Non-dataset kind rejected cleanly (4xx, no mutation) for at least one non-dataset kind.
- [x] 5.6 ACL: non-owner gets 404 on both routes, identical shape to the existing non-owner 404 for
      `DELETE`.
- [x] 5.7 Row-count limit: a request exceeding `staticMaxRows` is rejected with no partial write;
      include a concurrent-appends-jointly-exceeding-the-limit case (each individually under the
      limit, combined over it) to prove the check runs inside the lock, not before it.
- [x] 5.8 `inferred_schema` recompute: appending a row that changes a column's observed runtime type
      (e.g. the first numeric value into a column whose existing cells were all null) updates
      `inferred_schema` accordingly, verified by reading the source back after the write.
- [x] 5.9 RLS: exercise both routes' persistence under the app's actual non-superuser DB role (not
      the test-default superuser connection) — confirm a forced-RLS-scoped write actually succeeds
      for the owner and would be blocked for another user's session context, and confirm which
      connection pool (privileged vs. user-scoped) the new repository methods use.
- [x] 5.10 Schema validation reuse: a wrong-typed value and a missing-required-field value are each
      rejected via the existing `DatasetRowValidator` error format, exercised through the new routes
      (not just the validator's own existing unit tests).
- [x] 5.11 Response shape: append/replace responses include per-row `id`, `seq`, `updatedAt`, and the
      source's `updatedAt`.
