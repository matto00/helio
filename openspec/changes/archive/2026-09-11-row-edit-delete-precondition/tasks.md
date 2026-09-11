## 1. ### Backend — repository

- [x] 1.1 Add `DataSourceRepository.patchRow(sourceId, rowId, data: Vector[JsValue], expectedUpdatedAt, newUpdatedAt, user)`: `lockSource`, re-read schema (None = source 404), read the target row via `WHERE id = ? AND data_source_id = ?` (0 rows = row 404), `DatasetRowValidator.validate` the full submitted row against the current schema (invalid = 400, no mutation), then conditional `UPDATE ... WHERE id = ? AND data_source_id = ? AND updated_at = ?` (0 affected = 409), recompute `inferredSchema` over the full post-write set, bump source `updated_at` — all inside one `DBIO` chain under the source lock.
- [x] 1.2 Add `DataSourceRepository.deleteRow(sourceId, rowId, expectedUpdatedAt, newUpdatedAt, user)`: `lockSource`, re-read schema (None = source 404), read the target row via `WHERE id = ? AND data_source_id = ?` (0 rows = row 404), conditional `DELETE ... WHERE id = ? AND data_source_id = ? AND updated_at = ?` (0 affected = 409), recompute `inferredSchema` over remaining rows, bump source `updated_at`.
- [x] 1.3 Both return a result distinguishing every one of these outcomes (source-not-found / row-not-found / validation-failed (PATCH only) / stale-precondition / success — five outcomes for PATCH, four for DELETE) via a sealed trait or nested `Either`, never conflating any two.
- [x] 1.4 `newUpdatedAt` passed into both methods MUST be `Instant.now().truncatedTo(ChronoUnit.MICROS)`, matching every existing row writer (`DataSourceService.scala:744/774/794`) — verify the call site, don't just trust the method signature.

## 2. ### Backend — service + routes

- [x] 2.1 `DataSourceService.patchRow`/`deleteRow`: parse/validate `updatedAt` first (400 before any DB call), kind check (`dataset` only, else `BadRequest`) via the existing ACL-scoped source lookup (404 before kind check, matching `appendRows`'s order), delegate to repository, map the 4-way result to `NotFound`/`BadRequest`/`Conflict`/success per design.md D6's precedence.
- [x] 2.2 Add `PATCH /api/data-sources/:id/rows/:rowId` and `DELETE /api/data-sources/:id/rows/:rowId?updatedAt=...` in `DataSourceRoutes`, under the existing rate-limit/auth-composed `path(DataSourceIdSegment / "rows")` tree.
- [x] 2.3 Add a new `RowResponse` wire type (`{"row": {"id","seq","updatedAt","data"}, "sourceUpdatedAt"}`) to `DataSourceProtocol`/`JsonProtocols` for PATCH's 200 response — do NOT reuse `RowWriteResponse` (that type wraps a `rows` array and deliberately omits `data`, per HEL-1077 D6). DELETE returns `204` with no body.
- [x] 2.4 Emit `data_source.rows.patch`/`data_source.rows.delete` audit events on success, matching the existing `.append`/`.replace` pattern.

## 3. ### Schemas / OpenAPI

- [x] 3.1 Add `PATCH`/`DELETE .../rows/:rowId` to the OpenAPI spec in `openspec/` and any JSON Schema in `schemas/` covering the row-write request/response shapes, including the new `RowResponse` shape and the documented error precedence (400/404/400/409 order).

## 4. ### Frontend

- [x] 4.1 Add typed service calls (`patchDatasetRow`, `deleteDatasetRow`) to the data-sources frontend service module, matching existing append/replace call conventions, for HEL-1080 to consume once it also gets a row-read path (separate, spinoff ticket — see proposal.md Non-goals).

## 5. ### Tests

- [x] 5.1 Backend test: precondition-matching PATCH succeeds, returns the new row + advanced `updatedAt`, recomputes `inferred_schema`.
- [x] 5.2 Backend test: stale-precondition PATCH is rejected `409`, row unchanged.
- [x] 5.3 Backend test: PATCH supplying `null` for an optional column WITH NO DEFAULT stores `null` (true clear); PATCH supplying `null` for an optional column that HAS a default stores that default (per `DatasetRowValidator`'s existing null-fills-default behavior — this is expected, not a bug: note it explicitly in the spec scenario text too); PATCH supplying `null` for a required column with no default is rejected `400`.
- [x] 5.4 Backend test: precondition-matching DELETE removes the row (`204`) and recomputes `inferred_schema`.
- [x] 5.5 Backend test: stale-precondition DELETE is rejected `409`, row still exists.
- [x] 5.6 Backend test: PATCH/DELETE on a nonexistent `rowId` returns `404`. Separately, PATCH/DELETE using a `rowId` that belongs to a DIFFERENT source than `:id` (same owner, two sources) returns `404` AND leaves the other source's row completely unchanged — this is the cross-source-write regression test for design.md D1.
- [x] 5.7 Backend test: PATCH/DELETE on a non-`dataset`-kind source returns `400`.
- [x] 5.8 Backend test: cross-owner PATCH/DELETE (RLS, non-superuser role via `RlsOwnerTablesSpec`-style harness) returns `404`, never `403`, and the other user's row is unaffected — run under a real non-BYPASSRLS role, not the superuser test pool.
- [x] 5.9 Backend test: a real round-trip precondition test — `POST .../rows` to create a row, take that response's `updatedAt` literally, `PATCH` using it (succeeds), take THAT response's `updatedAt`, and `PATCH`/`DELETE` again using it (succeeds) — proving the MICROS-truncation convention round-trips correctly across two real writes, not just one (closes design.md D4's precision risk without depending on a GET that doesn't exist).
- [x] 5.10 Backend test: real concurrent test (not sequential calls, e.g. `Future.sequence` over two independent requests against the real DB) confirming two concurrent appends via `POST .../rows` still both land with distinct `seq` — verifying HEL-1077's existing guarantee is unaffected by this change's additions to the same repository file.
- [x] 5.11 Backend test: a schema-invalid PATCH against a row with a stale `updatedAt` returns `400` (validation-before-precondition order from design.md D6), not `409`.
