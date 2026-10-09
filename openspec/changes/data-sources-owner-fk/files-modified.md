- `backend/src/main/resources/db/migration/V119__data_sources_image_uploads_owner_fk.sql` — new: guard, delete orphans/NULL-owner sources + orphan uploads, NOT NULL + two CASCADE FKs, RLS bracket on five tables
- `backend/src/test/scala/com/helio/infrastructure/persistence/V119OwnerFkMigrationSpec.scala` — new: prod-role-shape (NOSUPERUSER NOBYPASSRLS owner) migration spec, guard/user-delete/inventory scenarios
- `backend/src/test/scala/com/helio/testsupport/UserSeeding.scala` — new: idempotent helper that seeds real `users` rows for fixtures
- `docs/user-reference-inventory.md` — new: FK table (parsed by the spec), indirect refs, cascade reach, audit residue
- `docs/README.md` — link the inventory
- `backend/src/test/scala/com/helio/infrastructure/persistence/FlywayNonSuperuserMigrationSpec.scala` — migrate to 118 first (V106 assertions read the dump's NULL-owner sources), then to latest and assert V119 deleted exactly those 2 sources + their rows
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala` — pin final migrate to 118 (tests V94; V119 deletes the dump's NULL-owner sources)
- `backend/src/test/scala/com/helio/infrastructure/persistence/DatasetRowsReaderBehaviorPreservingSpec.scala` — pin final migrate to 118 (reads MyManualSource by id)

## Fixture edits forced by the new FK / NOT NULL (C3: real `users` rows seeded, constraints untouched)
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceRepositorySpec.scala` — seed owner1, owner2 in beforeAll
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceSpec.scala` — seed `owner` in beforeAll
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceCsvUrlSpec.scala` — seed `owner` in beforeAll
- `backend/src/test/scala/com/helio/services/sources/CreateSourceEnvelopeSpec.scala` — seed `owner` in beforeAll
- `backend/src/test/scala/com/helio/services/sources/SchemaInferenceRegressionSpec.scala` — seed `owner` in beforeAll
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceRestartPersistenceSpec.scala` — seed `owner` in beforeAll
- `backend/src/test/scala/com/helio/domain/steps/UpsertSourceConfigSpec.scala` — seed ownerA, ownerB in beforeAll
- `backend/src/test/scala/com/helio/api/routes/sources/UploadRoutesSpec.scala` — seed the session user in beforeAll (image_uploads FK)
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` — seed viewerUser (the "other user" that owns a cross-user source) in beforeAll
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala` — seed the random "other user" inside the 404-for-other-owner test

## Unpinned real-dump specs (task 3.10a) — left as-is, with reasons
- V96, V106 specs: only mention the dump in comments; seed their own real users; their unpinned migrate runs V119 harmlessly over owned rows as a NOBYPASSRLS role.
- V118LegacyMetricFormatMigrationSpec: loads the dump but asserts nothing about data_sources/dataset_rows after latest.
- SchemaFieldRealDumpInvariantSpec: joins pipeline_roots to data_sources; the two deleted NULL-owner sources have no roots.

## Tests deleted (owner ruling "delete-both", escalation HEL-1347-1791527300914-0a2131) — premise made unrepresentable by V119
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala` "an owner_id IS NULL source's dataset_rows are invisible to any non-privileged user context" — removed, comment points at V119OwnerFkMigrationSpec (23502/23503)
- `backend/src/test/scala/com/helio/services/sources/RestSourceConnectorMigrationSpec.scala` "skip an ownerless legacy row without crashing (task 4.1a, round-3 CR5)" — removed, same pointer; the defensive branch in RestSourceConnectorMigration.scala is unchanged

## Mutation evidence (V119 restored byte-identical after each; run: `sbt "testOnly com.helio.infrastructure.persistence.V119OwnerFkMigrationSpec"`)
- Drop `NO FORCE` on `pipeline_roots` → RED "two roots" scenario: `Expected exception FlywayException to be thrown, but no exception was thrown (V119OwnerFkMigrationSpec.scala:144)` (guard blind, migration succeeds and deletes the root)
- Drop `NO FORCE` on `panels` → RED form-panel scenario: same "no exception was thrown" assertion
- Drop `NO FORCE` on `data_sources` → RED 3 scenarios: `SQL State: 42704 ... unrecognized configuration parameter "app.current_user_id"` (PL/pgSQL line 10)
- Drop `NO FORCE` on `pipeline_steps` → RED: SQLSTATE 42704 (fail-LOUD, line 18) — recorded as the explicit mutation result
- Drop `NO FORCE` on `image_uploads` → RED: FlywayMigrateException in the cleanup / clean-DB / live-source scenarios
- Drop root clause from the guard sum → RED two-root scenario: "Expected exception ... no exception was thrown"
- Drop step clause → RED join and upsertsource scenarios (2 failures): same assertion
- Drop panel clause → RED form-panel scenario: same assertion
- Drop closing `FORCE` on `panels` → RED cleanup + clean-DB scenarios: `Map(... "panels" -> false ...) was not equal to Map(... "panels" -> true ...)`
- Delete the `image_uploads` row from docs/user-reference-inventory.md → RED inventory scenario: `in the database but undocumented: HashSet((image_uploads,owner_id,CASCADE))`

## Shared dev DB (task 3.11) — V119 applied via the canonical start-servers.sh (Flyway on backend boot)
- Before: data_sources 3768, owner NULL 2, orphan-owner 57, dataset_rows doomed 306, pipeline_roots on doomed sources 0, orphan image_uploads 0, flyway max 118
- After: data_sources 3709 (= 3768 - 59), NULL 0, orphan 0, orphan image_uploads 0, flyway max 119 success, FORCE RLS on all 5 tables, `matt@helio.dev` still present
