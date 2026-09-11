## Why

There is no write path for a dataset's declared schema after creation. HEL-1079 (create-dataset UI)
needs an explicit block/warn/migrate answer for editing a schema with existing rows, and that answer
cannot exist without both the route and a data-integrity policy for what happens to those rows.

## What Changes

- New `PATCH /api/data-sources/:id/schema` route for `dataset`-kind sources: accepts a full replacement
  field-declaration list, validates it against the current declaration + existing rows, migrates or
  rejects per case (see design.md), and returns the new declaration plus a migration summary.
- New `DataSourceService.updateDatasetSchema` (locks the source row via the existing `lockSource`
  pattern, runs entirely inside one transaction with the row migration, defined as an explicit
  per-row index mapping — see design.md Decision 2).
- Existing rows are migrated in place (rename/reorder/add-optional/add-required-with-default/
  validation-only-retype) or the whole edit is rejected with a 409 naming the reason
  (add-required-without-default, retype with a value that does not already satisfy the new type,
  drop-with-data without `confirmDrop: true`). **Retype performs no value conversion** — it succeeds
  only when every existing value already satisfies the new declared type (design.md Decision 2/Risk 1).
- Contract: `schemas/`, OpenAPI, and frontend service types for the new route and its request/response
  shapes, in this PR.

## Capabilities

### New Capabilities
(none — this extends the existing `dataset-schema-api` capability's requirements)

### Modified Capabilities
- `dataset-schema-api`: adds a write/update requirement (currently read-only, `GET .../schema` only)
  covering the allowed-edit rules, row migration behavior, and rejection cases.

## Impact

- `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` (new route)
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` (new service method)
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala`
  (new repository method reusing `lockSource`)
- `backend/src/main/scala/com/helio/domain/engine/DatasetRowValidator.scala` (reused as-is for
  validation only — `validateValue`/`validateDefault`/`validate`; no new coercion helper, retype is
  validation-only per design.md)
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` (new request/
  response case classes)
- New Flyway migration only if a DB-level change is needed (expected: none — `dataset_schema`/
  `dataset_rows` already support arbitrary declarations; this is app-logic only)
- `schemas/`, `openspec/` OpenAPI, `frontend/src/services/*` types
- Non-superuser RLS-scoped integration test (new or extended existing dataset RLS suite)

## Non-goals

- No change to `DatasetFieldDeclaration`/`DatasetRowValidator`'s own shape (HEL-1076, unchanged).
- No UI (HEL-1079 consumes this API; UI itself is out of scope).
- No bulk/partial-field-patch semantics — the route takes a full replacement declaration list, matching
  `GET .../schema`'s full-list response shape (symmetry, no diffing ambiguity).
