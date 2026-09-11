## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **V number.** `git fetch origin` then `git ls-tree origin/main .../db/migration`: the latest file is `V105__oauth_states.sql`, even though origin/main has moved to 28630c79 since the merge-base (34cbfa78). V106 is still the next free number. AC1 met.
- **V106 SQL, read line by line myself.** The columns match V4's data_sources types (TEXT id, TIMESTAMPTZ). The table, index, ENABLE-then-FORCE, and policy are as designed. The NO FORCE/FORCE bracket covers every data_sources write. The backfill is `jsonb_array_elements ... WITH ORDINALITY`, with seq 0-based via `ord - 1`. The design text says `elem.ord`, but 0-based matches the app writers' `zipWithIndex`, so the code is right and the design wording is slightly off. The parity guard does exact `jsonb_agg(data ORDER BY seq) IS DISTINCT FROM COALESCE(config->'rows','[]')` and raises. dataset_schema comes from the declared `config->'columns'`. The constraint is dropped before the UPDATE and re-added after. config is cleared only after the guard. FORCE is restored on both tables. No defects found.
- **Independent non-superuser probe (my own, not the repo's tests).** I started a throwaway Postgres 18 cluster with a role `helio` (NOSUPERUSER NOBYPASSRLS) that owns `data_sources`. It had FORCE RLS and the V35 `data_sources_owner` policy, plus seeded static rows including a `config='{}'` row and a NULL-owner row. I applied the real `V106__dataset_rows.sql` as that role in one transaction:
  - `MIGRATION_OK`, with no 42704.
  - Rows were copied verbatim and in order, `2.0` preserved: `s1|0|["a", 1]`, `s1|1|["b", 2.0]`.
  - dataset_schema kept the raw declared types (`"number"`), config was `{}`, and the csv row was untouched.
  - After the migration, acting as the owner, the create path (insert source, insert row, update schema) and the refresh path (delete then reinsert) both succeeded under FORCE.
  - A second user saw 0 rows, and that user's cross-owner INSERT was rejected (`new row violates row-level security policy for table "dataset_rows"`).
  - Deleting the source cascaded its dataset_rows (0 left).
  - `relforcerowsecurity = t` on both tables.
  - Inserting `'static'` was rejected by the new CHECK.
  - This confirms the SQL and runtime RLS in the real prod topology (non-superuser owner under FORCE).
- **Repo tests, run by me.** `sbt testOnly` on V106DatasetRowsMigrationSpec, FlywayNonSuperuserMigrationSpec, RlsOwnerTablesSpec, DataSourceRepositorySpec, RlsPolicyGuardSpec and RlsPrivilegedDmlSpec gave 153/153 passed. On a second run of the first three I listed the test names: 25/25 passed, including the five new "RLS on dataset_rows" cases and the FlywayNonSuperuser case (`helio_migration_test`, NOBYPASSRLS) against `hel904-real-dump.sql`. AC2 and AC3 are met.
- **Persistence boundary.** `rowToDomain` handles `DataSourceKind.Static | "dataset"` and `domainToRow` writes `"dataset"`. I grepped all of main for `source_type` / `.sourceType` / `'static'` / `DataSourceKind.Static`. The remaining consumers are the wire-level `"static"` (HEL-1073 scope, correct to leave) and `WorkspaceTeardownService.filePathFor` (the `_ => ""` default is correct for dataset). No missed stored-value path. `update` (rename) still writes `config='{}'`, which is now harmless because the rows live in dataset_rows.
- **Readers and writers.** Every `readRawConfig` / `parseStaticPayload` call site in main is gone from the static path (engine :509, Spark :169, previewStatic :930). `createStatic` / `applyStaticRefresh` now call `insertDatasetSource` / `replaceDatasetRows` (transactional via `withUserContext` → `.transactionally`, checked in DbContext). Refresh ACL is `findByIdOwned` and the data_sources policy is owner-only (V35:43), so the owner-scoped dataset_rows policy does not regress shared editors (none exist).
- **Grants.** V106 issues no explicit `GRANT ... TO helio_privileged`, even though V100/V102/V103/V105 recommend doing so. I tallied V90–V105: V91/V93/V94/V98/V101 all created privileged-read tables with zero GRANT lines and work in prod through V38's `ALTER DEFAULT PRIVILEGES`. V100's claim that "V94 issues explicit grants" is false (`grep -c '^GRANT' V94` = 0). So this is not blocking (see notes).
- **AC5 (before/after on the real fixture): NOT met.** See CR1.
- **AC10 (scaladoc): only partially met.** See CR2.

### Verdict: REFUTE

The SQL and RLS work is solid, and I reproduced it independently. The refutation is about two acceptance criteria that are checked off but not actually delivered, plus one leftover writer to the retired store.

### Change Requests

1. **AC5 / tasks.md 3.7: the before/after reader comparison on the real fixture does not exist, but the task is marked `[x]`.** The ticket requires the reader swap to be "proven behavior-preserving via before/after comparison on the real fixture (not merely 'tests still pass')". design.md Decision 9 specifies the mechanism: capture golden output from the three legacy readers against `hel904-real-dump.sql`, then migrate, then re-run and diff.
   - Nothing in the diff does this. `grep -ri golden backend/src/test` finds only unrelated resources.
   - The evaluator accepted three substitutes, and none of them is the comparison:
     - The mocked InProcessPipelineEngineSpec and SparkJobSubmitterSpec *override* `readDatasetRows`, so the real SQL never runs against migrated data.
     - `DataSourceRepositorySpec` only reads rows written by `insertDatasetSource`, never migration-backfilled rows.
     - FlywayNonSuperuserMigrationSpec checks raw table content for **one** of the fixture's ~10 static sources (`MyManualSource`) and never calls any reader.
   - **Required:** add a test that:
     1. Loads `hel904-real-dump.sql` through `target("105")`.
     2. For **every** `source_type='static'` row, captures the legacy output: `parseStaticRows(config)` rows, preview headers/rows, and the Spark-relevant `columns[].{name,type}`.
     3. Migrates to latest.
     4. Calls the real `DataSourceRepository.readDatasetRows` (not a mock) plus `parseStaticRows(obj)` / the preview projection for the same ids.
     5. Asserts exact equality of rows, order and declared types for all of them.

   Keep the NULL-owner `MyManualSource` and the `"number"`-typed sources (`HEL-315 offers src`, `skeptic-src`) in the set. If the test has to live behind the V105 target, reuse FlywayNonSuperuserMigrationSpec's harness.

2. **AC10: stale storage premise left in the same file.** `backend/src/main/scala/com/helio/domain/model/DataSource.scala:10-21` (the `DataSource` trait scaladoc) still says three things that are now false:
   - StaticSource's "column/row payload lives in [[CsvSourceConfig]] and the linked `DataType` row" (the exact premise HEL-1118 traced back to a stale scaladoc).
   - "The DB table shape is unchanged".
   - "`data_sources.config` continues to hold the typed config".

   Also `DataSourceRepository.scala` (the scaladoc on `parseStaticPayload`, ~line 503) says it is "Used by the in-process engine + Spark submitter ... and by the protocol layer's StaticSource response materialization". After this diff, none of those call it. Correct both so they match the post-migration reality.

3. **Remove the dead `DataSourceRepository.updateStaticPayload` (DataSourceRepository.scala ~196-211).** After this diff it has zero callers in main or test (`grep -rn updateStaticPayload backend/src`). It still writes `{columns, rows}` into `data_sources.config`, the store this change retires. The ticket's item 8 and HEL-1075 say writes to it should stop for dataset sources. Leaving a ready-made writer to the retired blob is a trap for HEL-1077/1078: rows written through it would be silently invisible to every reader.

### Non-blocking notes

- **Refresh atomicity.** `applyStaticRefresh` calls `replaceDatasetRows` and then `upsertSourceDataType` in two separate transactions. Decision 7's text says `upsertInferredSchema` runs "inside this same transaction". rows and dataset_schema are atomic, as required. inferred_schema can lag on a mid-way failure, which is the same risk as before the change. Either fold it into the same DBIO or amend the design text.
- **Declared-type drift between new and migrated rows.** New create/refresh writes canonicalize declared types via `validateAndCanonicalize` (`number`/`double`→`float`, `long`→`integer`, `date`→`timestamp`). Backfilled rows keep the raw types (the real fixture has `"number"`). The only consumer of dataset_schema types is `SparkJobSubmitter.sparkDataType`, so the same payload would map to different Spark types, and `long`→IntegerType would narrow with `n.toInt`. This is dormant today: `ApiRoutes` passes `executionBackend = null`, so PipelineRunService always uses the in-process engine, which ignores types. Flag it for HEL-1073/1077.
- **Refresh of a vanished source.** `replaceDatasetRows` on a source deleted mid-refresh now succeeds silently. The old `updateStaticPayload` returned `None`, which failed loudly. Low impact.
- **Grants.** Adding an explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON dataset_rows TO helio_privileged` would follow the V102/V103/V105 recommendation at no cost. It is not required, given the V94/V98/V101 precedent working in prod. Also, V100's header claims V94 has explicit grants, which is false.
- `readRawConfig` now has no main callers (one test only). The design wording `elem.ord` should say `elem.ord - 1`.
