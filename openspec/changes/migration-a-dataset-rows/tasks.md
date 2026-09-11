## 1. Migration

- [x] 1.1 Re-verify `origin/main`'s latest migration V-number immediately before writing the file; do not
      hardcode V106.
- [x] 1.2 Create `dataset_rows` table (`TEXT` PK/FK matching `data_sources.id`'s actual type, `UNIQUE
      (data_source_id, seq)`, index) with `ENABLE` (not yet `FORCE`) RLS and the `dataset_rows_owner`
      policy (design.md Decision 1).
- [x] 1.3 `ALTER TABLE data_sources NO FORCE ROW LEVEL SECURITY` before any statement below that
      touches `data_sources` (design.md Decisions 1/2 — the `V94`/`V96` pattern, not `V35`'s runtime
      policy shape).
- [x] 1.4 Backfill `dataset_rows` from `data_sources.config` for `source_type = 'static'` rows using
      `jsonb_array_elements(COALESCE(config->'rows', '[]'::jsonb)) WITH ORDINALITY` for `seq` (matches
      `V96`'s idiom); `data` is the row's JSON array value **verbatim** (positional, not object-keyed —
      design.md Decision 3, round 2). The `COALESCE` covers sources whose `config = '{}'` (the
      pre-existing rename-wipes-rows state, `DataSourceRepository.scala:175`) by inserting zero rows,
      not erroring.
- [x] 1.5 In-migration **content-level** parity guard: a `DO $$ ... RAISE EXCEPTION ... $$` block
      asserting, per migrated source, `jsonb_agg(dr.data ORDER BY dr.seq)` (or `'[]'::jsonb` if none)
      `IS NOT DISTINCT FROM COALESCE(ds.config->'rows', '[]'::jsonb)` — exact positional-array equality,
      not merely a row-count comparison (design.md Decision 2 step 2, round 2 finding) — aborting the
      transaction on any mismatch (design.md Decision 4's stated precondition for clearing `config`).
- [x] 1.6 Backfill `dataset_schema` from `COALESCE(config->'columns', '[]'::jsonb)` (declared name+type,
      in blob order) — NOT from `inferred_schema` (design.md Decision 3: declared and runtime types
      diverge in the real fixture; Spark needs the declared type). The `COALESCE` guarantees a non-null
      `dataset_schema` even for a `config = '{}'` source.
- [x] 1.7 Drop `data_sources_source_type_check`; run `UPDATE data_sources SET source_type = 'dataset'
      WHERE source_type = 'static'`; re-add the constraint with `dataset` replacing `static`
      (`rest_api, csv, dataset, sql, text, pdf, image`) — constraint drop MUST precede the UPDATE
      (design.md Decision 5; round-1 draft had this backwards).
- [x] 1.8 Clear `config` to `'{}'::jsonb` for the migrated rows, gated on 1.5's parity check having
      passed for those rows (design.md Decision 4).
- [x] 1.9 `ALTER TABLE data_sources FORCE ROW LEVEL SECURITY` (restore).
- [x] 1.10 `ALTER TABLE dataset_rows FORCE ROW LEVEL SECURITY` (apply, now that backfill is complete).

## 2. Persistence-boundary mapping (new — round-1 skeptic finding)

- [x] 2.1 `DataSourceRepository.rowToDomain`: map `row.sourceType == "dataset"` to `StaticSource`
      (design.md Decision 6) — without this, every migrated row crashes `findAll` via the existing
      `case other => throw IllegalStateException`.
- [x] 2.2 `DataSourceRepository.domainToRow`: write `"dataset"` (not `"static"`) for a `StaticSource` —
      without this, `createStatic`/every static-creation path (`PipelineService`,
      `PipelineProposalService`, `PatchSetApplyResolvers`) fails against the new CHECK constraint.
- [x] 2.3 Add/update repository-level tests for both directions (round-trip a `StaticSource` through
      insert/read with the new `"dataset"` stored value).

## 3. Legacy reader/writer swap

- [x] 3.1 Add `DataSourceRepository.readDatasetRows(id): Future[Option[JsObject]]` returning
      `{columns, rows}` (same shape `parseStaticPayload` produces) from `dataset_schema` (raw column
      query, NOT via `rowToDomain`/the ADT — design.md Decision 9) + `dataset_rows.data` ordered by
      `seq` (a straight positional copy, no reconstruction), running on the **privileged pool**
      (`ctx.withSystemContext`), matching `readRawConfig`'s existing pool choice for all three callers.
      **Read `dataset_schema` and `dataset_rows` in a single statement** (join or correlated subselect,
      not two sequential queries), so a concurrent `refreshStatic` cannot hand back a schema/rows pair
      from two different points in time (design.md Decision 9).
- [x] 3.2 Swap `InProcessPipelineEngine.scala:509`/`PipelineRowJson.scala:140` onto `readDatasetRows`.
- [x] 3.3 Swap `SparkJobSubmitter.scala:169,171` onto `readDatasetRows` (verify Spark's `StructType`
      still derives from the **declared** type, now sourced from `dataset_schema`, not
      `inferred_schema`).
- [x] 3.4 Swap `DataSourceService.previewStatic` (`:930,933`) onto `readDatasetRows`.
- [x] 3.5 Retarget `DataSourceService.createStatic` (`:146`) to insert `dataset_rows` + upsert
      `dataset_schema` in one transaction (design.md Decision 7) instead of `updateStaticPayload`.
- [x] 3.6 Retarget `refreshStatic`/refresh path (`:723`) to delete-and-reinsert `dataset_rows` **and**
      update `dataset_schema` in one transaction (design.md Decision 7 — round-1 draft omitted the
      `dataset_schema` update on refresh).
- [x] 3.7 Before/after comparison (design.md Decision 9's concrete mechanism): capture golden output
      from all three legacy readers against `hel904-real-dump.sql` BEFORE writing the swap code; re-run
      the swapped readers against the same fixture AFTER; diff rows/order/types exactly.

## 4. RLS proof

- [x] 4.1 Extend `FlywayNonSuperuserMigrationSpec` (not `RlsOwnerTablesSpec` — that harness covers
      runtime access only, not migration-time DML) to run the full chain including this migration
      against `hel904-real-dump.sql` as the non-BYPASSRLS `helio_migration_test` role, asserting it
      applies cleanly and `dataset_rows` is correctly populated.
- [x] 4.2 Add a runtime RLS spec (new, or extend `RlsOwnerTablesSpec`) covering `dataset_rows`: owner A
      cannot see owner B's rows; `withSystemContext` sees all; no `app.current_user_id` set → the
      query **raises an error** (SQLSTATE 42704 — `current_setting(...)` has no `missing_ok`, matching
      the existing, tested contract in `RlsOwnerTablesSpec`; do NOT weaken the policy to `missing_ok` to
      make a "zero rows" expectation pass); the `owner_id IS NULL` source's rows are invisible to every non-privileged user
      (design.md Decision 8), not just superuser/privileged pool.
- [x] 4.3 Register `dataset_rows` in `RlsPolicyGuardSpec`'s expected-table list.

## 5. Fixture-based verification

- [x] 5.1 Use `backend/src/test/resources/db/fixtures/hel904-real-dump.sql` (already in-repo, contains
      genuine `static` sources including the `owner_id NULL` row `MyManualSource`) — do not hand-build a
      fixture.
- [x] 5.2 Run the full migration against that fixture and assert: constraint accepts `dataset`, rejects
      `static`; `dataset_rows` populated and content-parity-checked (exact positional match, not just
      count) for every migrated source; `dataset_schema` backfilled from declared columns (verify
      against the fixture's own declared types, e.g. `MyManualSource`'s `test3: float`); `config`
      cleared for migrated rows; the `owner_id NULL` row's `dataset_rows` migrated but invisible under
      any non-privileged user context.
- [x] 5.3 Augment the fixture (in a test-only copy/seed, not by editing `hel904-real-dump.sql` itself)
      with edge-case `static` sources the real dump does not contain, per skeptic round-2 CR1/CR2, and
      assert the migration handles each without error or silent data loss:
      - a source with `config = '{}'` (the real, pre-existing rename-wipe state) — migrates to zero
        `dataset_rows` and `dataset_schema: []`, not `NULL` or a migration failure;
      - a source whose declared `columns` contains a duplicate name — since `data` is now a positional
        array (not object-keyed), this migrates losslessly with no collapse;
      - a source with a row longer or shorter than `columns` — migrates the row verbatim (positional
        copy preserves whatever the blob actually held, ragged or not), and `readDatasetRows` returns it
        unchanged rather than silently padding/truncating.

## 6. Existing test-seed migration (new — round-3 skeptic finding)

- [x] 6.1 `grep -rn "'static'" backend/src/test --include=*.scala` and classify every hit: (a) a raw-SQL
      seed inserting `data_sources` rows with `source_type = 'static'` (55 occurrences across ~33 files
      as of round 3 — re-enumerate, don't trust this count blindly, per the ticket's own standing
      instruction), vs. (b) a version-pinned migration spec that deliberately targets a pre-migration
      schema (e.g. `V98PipelineRootsMigrationSpec`) and must correctly keep `'static'`.
- [x] 6.2 For every (a) seed: rewrite `source_type` to `'dataset'`, and — for the ~10+ files that also
      seed non-empty `rows` into `config` (e.g. `PipelineRunRoutesSpec`, `HookRoutesSpec`,
      `DataSourceRoutesSpec`, `CombinedApplyProposalSpecBase`) — move those rows into `dataset_rows`
      inserts (+ `dataset_schema`) instead, via one shared test helper rather than ad hoc per-file SQL.
      **Do not weaken any existing assertion** to make a test pass after this change; a test that
      silently starts asserting over zero rows instead of failing is a worse outcome than the raw SQL
      simply failing the CHECK constraint.
- [x] 6.3 Leave every (b) version-pinned spec unchanged.

## 7. Scaladoc + cleanup

- [x] 7.1 Correct `StaticSource`'s scaladoc in `DataSource.scala` per design.md Decision 9 (rows live in
      `dataset_rows`, `source_type = 'dataset'`, `config` unused/cleared — do not claim HEL-1073's future
      ADT rename as already true).
- [x] 7.2 Remove `files-modified.md` handoff before archive (standard Delivery step).
