## Why

HEL-1077 shipped append/replace for dataset rows but explicitly deferred per-row edit and delete as
a Non-Goal. Interactive editing (HEL-1080's grid) needs a way to change or remove a single row
without silently clobbering a concurrent edit by another client tab/session.

## What Changes

- Add `PATCH /api/data-sources/:id/rows/:rowId` — full-row replace of the row's cells, guarded by an
  `updatedAt` precondition carried in the request body; rejects with `409` if the row changed
  underneath.
- Add `DELETE /api/data-sources/:id/rows/:rowId?updatedAt=...` — guarded by the same precondition;
  removes the row.
- Reuse `DatasetRowValidator`, the ACL/kind checks, and `DataSourceRepository.lockSource` HEL-1077
  already established — no forked validation/locking logic. The source's `FOR UPDATE` lock is what
  actually serializes concurrent writers to the same source's rows (as it already does for
  append/replace); the `updated_at` predicate on the mutation statement is the stale-client check on
  top of that, not a standalone concurrency mechanism.
- The mutation's `WHERE` clause is scoped to `id = ? AND data_source_id = ? AND updated_at = ?` — a
  `rowId` from a different source than `:id` is a 404, never a cross-source write.
- `updated_at` recomputed on successful edit (never left stale, using the same
  `Instant.now().truncatedTo(ChronoUnit.MICROS)` convention every existing row writer uses);
  `inferred_schema` recomputed after an edit or delete that changes the stored row set.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `dataset-row-write-api`: adds per-row `PATCH`/`DELETE` requirements with an `updatedAt`
  precondition, alongside the existing append/replace requirements.

## Impact

- `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` — two new routes.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — `patchRow`/`deleteRow`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` —
  conditional-update/delete DBIO actions, reusing `lockSource`.
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — request/response
  wire types.
- `schemas/` and `openspec/specs/` (OpenAPI) — new endpoint definitions.
- `frontend/src/services/` — typed client calls for HEL-1080 to consume later.

## Non-goals

- Auto-running downstream pipelines on edit/delete (separate epic, HEL-1091).
- Bulk multi-row PATCH/DELETE — single-row only, matching HEL-1080's grid interaction model.
- A `GET` endpoint that lists row `id`/`seq`/`updatedAt`. No such endpoint exists today
  (`readDatasetRows` returns raw cell data only, no identity). This change exposes row identity only
  through append/replace/patch/delete responses. A row-listing `GET` is a real, separate need for
  HEL-1080's grid to be able to issue a PATCH/DELETE at all — filed as a spinoff ticket at Delivery
  time (see "Triaging a suggested follow-up") rather than added to this change's scope.
