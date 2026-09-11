# Files modified — HEL-1124

Migration: **none added**. `dataset_schema`/`dataset_rows` already support arbitrary
declarations and arbitrary-length positional arrays (V106, HEL-1074); this ticket is app-logic
only, as design.md Decision 9 expected. No `V107__*.sql` file exists in this change.

## Backend

- `backend/src/main/scala/com/helio/domain/engine/DatasetSchemaMigration.scala` — new. The pure,
  DB-free Step A-D schema-edit planner (design.md Decision 2): identity-mapping/structural
  validation (Step A/B), the single general per-field candidate/touched/default/required
  algorithm (Step C), and row-migration + `rowsMigrated` computation (Step D / Decision 6).
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala`
  — new `updateDatasetSchema` (locks the source via `lockSource`, re-reads declaration/rows fresh
  under the lock, resolves the wire payload to `FieldEditSpec`s, calls `DatasetSchemaMigration.plan`,
  then `persistMigrationAction` for the Decision 8 final re-validation + write). `persistMigrationAction`
  and `applyMigrationForTest` are `private[sources]` so `DataSourceRepositorySpec` can exercise the
  Decision 8 safety net directly, bypassing `plan`.
- `backend/src/main/scala/com/helio/services/sources/DataSourceSchemaUpdateError.scala` — new.
  Structured-409 wrapper mirroring `DataSourceDeleteError`'s (HEL-987) precedent.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — new
  `updateDatasetSchema`: ACL via `findByIdOwned` (HEL-1002 404 shape), `400` for a non-dataset
  kind, maps the repository's rejection to `400`/`409`.
- `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` — new
  `PATCH /api/data-sources/:id/schema` route alongside HEL-1122's `GET` at the same path;
  `completeSchemaUpdate` bespoke-completion helper mirroring `completeDelete`.
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — new wire
  types: `DatasetFieldDeclarationPayload`, `UpdateDatasetSchemaRequest`, `SchemaFieldRejection`,
  `SchemaUpdateConflictResponse`, `DatasetSchemaUpdateResponse`, plus their JSON formatters
  (hand-rolled where the `Option[Option[JsValue]]` idiom or a non-`Option` case-class default
  needs it). The shipped `DatasetSchemaResponse`/`jsonFormat1` is untouched.

## Backend tests

- `backend/src/test/scala/com/helio/domain/engine/DatasetSchemaMigrationSpec.scala` — new.
  Exhaustive, DB-free coverage of tasks.md 4.1-4.13 (every allowed/rejected/structural case,
  including the round-4 "touched" gate and the round-2 chained-rename/collision distinction)
  directly against the pure planner.
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceRepositorySpec.scala`
  — persistence-level coverage: rename/drop actually persisted, caller-supplied bad `type`/`default`
  rejected structurally, not-found, the Decision 8 safety-net rollback test (4.12a, via
  `applyMigrationForTest` with a deliberately inconsistent migration), the no-backfill-on-untouched
  persistence check (4.12b), and the real overlapping-`Future`s concurrency test (5.1, task 5.1 —
  a barrier-synchronized schema-edit-races-append, not two sequential calls).
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala` — new
  (a)/(b)/(c) RLS boundary test for `updateDatasetSchema` (task 6.1), reusing the same structure as
  the existing `listRows` RLS test: non-owner repository call denied, owner positive control, and a
  RAW non-owner `UPDATE` directly against `dataset_rows` denied by `dataset_rows`' OWN RLS policy
  (contrasted with the same query on the privileged pool).
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — HTTP-wiring
  smoke tests for the new route: rename (200), drop-without-confirm (409, structured body),
  drop-with-confirm (200), malformed `previousName` (400), non-dataset kind (400), cross-owner
  (404), and a regression check that `GET`'s response shape is unaffected.
- `backend/src/test/scala/com/helio/api/protocols/sources/DataSourceProtocolSpec.scala` — JSON
  round-trip tests for the new wire types, in particular the `default`/`confirmDrop` absent-vs-null
  vs-supplied distinctions.

## Contract

- `schemas/sources/dataset-field-declaration-payload.schema.json` — new.
- `schemas/sources/update-dataset-schema-request.schema.json` — new.
- `schemas/sources/schema-field-rejection.schema.json` — new.
- `schemas/sources/schema-update-conflict-response.schema.json` — new.
- `schemas/sources/dataset-schema-update-response.schema.json` — new.
- `openspec/changes/declared-schema-update-api/specs/dataset-schema-api/spec.md` — the proposed
  capability delta (already present from Planning; merges into
  `openspec/specs/dataset-schema-api/spec.md` at archive time, per this repo's OpenSpec convention).
- `frontend/src/features/sources/types/dataSource.ts` — new `DatasetFieldDeclarationPayload`,
  `UpdateDatasetSchemaRequest`, `DatasetSchemaUpdateResponse`, `SchemaFieldRejection`,
  `SchemaUpdateConflictResponse` types. The shipped `DatasetSchemaResponse` is untouched.
- `frontend/src/features/sources/services/dataSourceService.ts` — new `updateDatasetSchema` client
  function (`PATCH /api/data-sources/:id/schema`).

## Verification gates run (fresh, this cycle)

- `sbt test` (backend): **4246 tests, 0 failed** (full suite, ~5m9s).
- `npm run lint`: clean (zero-warnings ESLint policy).
- `npm run typecheck`: clean.
- `npm run format:check`: clean.
- `npm test` (frontend + helio-mcp): **3298 tests, 0 failed**.
- `npm --prefix frontend run build`: succeeds.
- `node scripts/check-schema-drift.mjs`: in sync (95 protocol/schema pairs checked).
- `openspec validate declared-schema-update-api --type change`: valid.
