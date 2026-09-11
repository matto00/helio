## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

I re-checked each round-1 change request against the current design.md, tasks.md, and spec deltas, and against the real code and migrations.

1. **RLS bracket: fixed.** `V96__canonicalize_inferred_schema_type.sql:37,55` brackets its UPDATE with `NO FORCE`/`FORCE` on `data_sources`. `V94` does the same (section 0 at `:123`, restore at `:1310`) and creates new tables ENABLE-only, applying FORCE at the end (`:226-235`, `:1319+`). Decision 1's SQL skeleton (sections A/B/C) and tasks 1.2/1.3/1.9/1.10 now follow exactly this pattern. The `dataset_rows_owner` EXISTS subquery reads `data_sources` inside the NO FORCE window, and `dataset_rows` is not yet forced, so the owner-role backfill passes. Task 4.1 targets `FlywayNonSuperuserMigrationSpec`. That spec migrates to V93, loads `hel904-real-dump.sql`, then migrates to head as `helio_migration_test` NOBYPASSRLS (`FlywayNonSuperuserMigrationSpec.scala:107,124,148`), so the new migration runs under it. Task 4.3 registers the table in `RlsPolicyGuardSpec`.
2. **Persistence mapping: fixed.** `DataSourceRepository.scala:64-65` (`case DataSourceKind.Static`) and `:88` (`case _: StaticSource => (DataSourceKind.Static, "{}")`) match Decision 6 and tasks 2.1-2.3.
3. **dataset_schema source: fixed in principle.** It is now backfilled from `config->'columns'`. `SparkJobSubmitter.scala:174-180` really does build the `StructType` from the declared `columns[].type`. The divergence from the ticket's wording is recorded. See CR 2 for a gap.
4. **Row shape: pinned** as an object keyed by column name. The pin itself introduces a new problem; see CR 1.
5. **Statement order: fixed.** Decision 2 steps 4 and 5 and task 1.7 drop the constraint, run the UPDATE, then re-add it. The parity guard is an in-migration `DO $$ … RAISE EXCEPTION $$` (task 1.5).
6. **Key types: fixed.** TEXT in Decision 1 and in both the dataset-row-storage and data-source-persistence deltas.
7. **`owner_id IS NULL`: fixed.** Decision 8 plus a spec scenario plus task 4.2. Fixture line 1187 (`MyManualSource`, owner NULL) confirmed.
8. **Atomic writes: fixed.** Decision 7 and tasks 3.5/3.6 require a single DBIO, and refresh updates `dataset_schema`.
9. **Before/after mechanism: concrete.** `hel904-real-dump.sql` is named, and golden values are captured before the swap. Feasibility is confirmed: `SparkJobSubmitterSpec.scala:82-202` already exercises `loadDataFrame` with a local Spark.

Additional ground-truth probes (new this round):
- `DataSourceService.createStatic` (`DataSourceService.scala:96-122`) validates only name, row count (<=500), and column types. **Nothing validates unique column names or `row.length == columns.length`**. A grep for duplicate/ragged/length checks across the sources service, protocols, and routes returned nothing.
- The legacy readers are **positional**. Preview emits each stored row verbatim (`DataSourceService.scala:936-944`). Spark zips row values with schema fields by position (`SparkJobSubmitter.scala:182-186`). Only `parseStaticRows` (`PipelineRowJson.scala:144-147`) keys by name (`zip` + `toMap`).
- **Renaming a static source today writes `config = '{}'`.** `DataSourceService.update` (`:558`) calls `DataSourceRepository.update`, which has `case _: StaticSource => "{}"` (`DataSourceRepository.scala:175`). That wipes the blob. Prod can therefore contain `static` rows whose `config` has no `columns`/`rows` keys.
- `RlsOwnerTablesSpec.scala:482-500`: with `app.current_user_id` unset, the owner policy **raises an error**, not zero rows.

### Verdict: REFUTE

All nine round-1 items are genuinely addressed. Two new defects come from the revisions themselves (the object-keyed row shape and the declared-columns backfill). Both land on the irreversible `config` clear, so they block.

### Change Requests

1. **The object-keyed `data` shape is lossy for data the app accepts today, and the count-only parity gate cannot detect that loss before `config` is irreversibly cleared.**
   - With no uniqueness or rectangularity validation (`DataSourceService.scala:96-122`), stored blobs can hold:
     - (a) duplicate column names, which collapse to one key;
     - (b) rows longer than `columns`, whose extra cells are dropped;
     - (c) rows shorter than `columns`, where a missing key is indistinguishable from an explicit `null`.

     Preview (`DataSourceService.scala:936-944`) and Spark (`SparkJobSubmitter.scala:182-186`) are positional. For those sources, output after the migration would differ from the legacy readers, which violates the "behavior-preserving" AC. Decision 2 step 2 / task 1.5 compares row **counts** only, so it passes, and step 5 then clears `config`, destroying the only lossless copy. The real fixture contains none of these cases, so task 3.7's golden diff cannot catch it either. Required revisions:
   - **(a) Reconstruction semantics.** Define exactly how `readDatasetRows` reconstructs a positional row from `dataset_schema` + `data`, including a missing key versus JSON `null`. Then show that it round-trips every shape the legacy readers accept, or state which shapes it does not.
   - **(b) Content-level parity check.** Make the in-migration parity guard compare content, not just counts. For each migrated row, the reconstructed positional array must equal the original `rows[i]`; any mismatch RAISEs. Otherwise, specify what the migration does with non-representable sources: keep `config` for them, normalize them deterministically, or abort. Justify the choice, since aborting blocks the prod deploy. Consider a pre-flight probe query against prod to size this.
   - **(c) Going-forward writes.** Decide whether `createStatic`/`refreshStatic` now reject duplicate column names and ragged rows with a 400. That is a behavior change: add the scenarios to the static-data-connector delta and a task. Otherwise, specify how such payloads are stored.
   - **(d) Edge-case tests.** Add migration tests that seed duplicate-name, long-row, and short-row static sources on top of the real fixture (augmenting it, not replacing it) and assert the chosen behavior.

   If none of this is palatable, positional `data` (a JSON array aligned to `dataset_schema`) is the alternative. Record the trade-off either way.

2. **The `dataset_schema` backfill must handle `config` lacking `columns`. Such rows are real, because the rename path writes `'{}'`** (`DataSourceService.scala:558` → `DataSourceRepository.scala:175`).
   - A naive `SET dataset_schema = config->'columns'` yields `NULL`. That contradicts the data-source-persistence delta's scenario ("each is left with … a non-null `dataset_schema`").
   - Specify `COALESCE(config->'columns', '[]'::jsonb)` or equivalent in Decision 2 step 3 / task 1.6.
   - Specify that `readDatasetRows` returns an empty `{columns: [], rows: []}` for such a source, matching today's `parseStaticPayload("{}")` behavior.
   - Add a fixture-augmented test row with `config = '{}'`.
   - Record in design.md that this migration incidentally ends the rename-wipes-rows data loss for static sources (after the migration, `config` is no longer the row store). Consider a spinoff to tell affected users, since their rows are already gone.

3. **Correct task 4.2's fail-closed expectation.**
   - Task 4.2 says "no `app.current_user_id` set → zero rows (fail-closed)". The Decision 1 policy uses `current_setting('app.current_user_id')` without `missing_ok`, which **raises**. This is the established, tested contract (`RlsOwnerTablesSpec.scala:482-500`).
   - Reword task 4.2 to "raises an error", matching the existing assertion. As written, it invites the executor to "fix" the test by weakening the policy to `missing_ok`.

### Non-blocking notes

- **`readDatasetRows` pool.** State which pool `readDatasetRows` runs on. Its engine and Spark callers have no user context today, which is why `readRawConfig` uses `withSystemContext` (`DataSourceRepository.scala:209-210`). Under FORCE RLS, a user-context-less read on `dataset_rows` would raise. Say it uses the privileged pool, like `readRawConfig`, while the preview path could stay user-scoped.
- **Backfill column values.** The backfill SQL should specify how `dataset_rows.id` is generated (e.g. `gen_random_uuid()::text`) and how `created_at`/`updated_at` are set (source timestamps vs `now()`). Both are NOT NULL with no default.
- **Slick row mapping.** `DataSourceRow`/`DataSourceTable` do not map `dataset_schema`. That is fine for insert (it defaults to NULL, then is upserted in the same transaction), but say whether the Slick row gains the column or `dataset_schema` stays repository-internal.
