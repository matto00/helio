## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round-2 CRs: all three are substantively fixed.**

1. **Positional `data` (round-2 CR1).** Decision 3 (design.md:175-191), the dataset-row-storage delta, and task 1.4 now store `data` as a verbatim copy of `config->'rows'[i]`.
   - I checked every legacy reader. All three already consume `rows` as `Vector[Vector[JsValue]]`:
     - `PipelineRowJson.scala:142`
     - `SparkJobSubmitter.scala:173`
     - preview, which emits rows verbatim
   - So any blob a legacy reader can read is an array of arrays, and a verbatim copy reproduces it exactly.
   - `parseStaticRows`'s `zip(...).toMap` gets the same input as before, so its duplicate-name and ragged-row behavior is unchanged, not "fixed". That is correct for a behavior-preserving swap.
   - Duplicate-name collapse and missing-vs-null ambiguity are eliminated at the storage layer.
   - Every static creation path funnels through `DataSourceService.createStatic`: `PipelineService.scala:763`, `PipelineProposalService.scala:374`, and the route. So Decision 7 covers all writers.
   - No new lossiness is introduced.
2. **Parity guard SQL.** A per-source correlated `(SELECT jsonb_agg(dr.data ORDER BY dr.seq) FROM dataset_rows dr WHERE dr.data_source_id = ds.id)` is valid Postgres. Ordered-aggregate syntax is fine.
   - It yields SQL NULL for zero rows. Task 1.5 explicitly maps that to `'[]'::jsonb`, so the `IS NOT DISTINCT FROM` comparison is sound.
   - `jsonb` equality is semantic, and the copy is verbatim, so there are no false mismatches.
3. **COALESCE coverage.**
   - `config` is `NOT NULL` (`V4__data_sources_and_types.sql:5`).
   - Missing key (the rename-wipe `'{}'`, `DataSourceRepository.scala:175`) gives SQL NULL, which COALESCE catches.
   - A non-object `config` (array or scalar) gives SQL NULL from `->'rows'`, with no error, which COALESCE catches. That matches `parseStaticPayload`'s `case _ => JsObject.empty` (`DataSourceRepository.scala:394-398`).
   - The uncovered case is a JSON `null` or non-array `rows` value: `jsonb_array_elements` would raise. No writer can produce that: `createStatic` and `refresh` serialize typed `req.rows`. The legacy readers would also throw on it, so aborting is acceptable. See the non-blocking note.
4. **Task 4.2.** Now says the query raises SQLSTATE 42704 and forbids `missing_ok`. This matches `RlsOwnerTablesSpec`.
5. **`readDatasetRows`.** It is on `withSystemContext`, matching `readRawConfig` (`DataSourceRepository.scala:209-210`), and uses a raw column query that bypasses the ADT. This is consistent with the Non-Goals.
6. **Backfill values.** `gen_random_uuid()` is already used in migrations (V6, V11, V92). The timestamps come from the source.
7. **Real fixture.** `hel904-real-dump.sql:1187-1214` holds 10+ genuine `static` rows. All are rectangular with unique names, so task 5.3's augmentation is genuinely needed and correctly scoped as a test-only seed.

### Verdict: REFUTE

The technical design is now sound. Two planning defects remain:
- Stale text in design.md directly contradicts the round-2 revisions on the two points this round exists to settle.
- A large, certain breakage in the test suite has no task.

Both are cheap to fix. Neither can be left to execution: the first invites the exact regressions round 2 closed, and the second invites fixture-weakening.

### Change Requests

1. **Remove the stale round-1/round-2 text that contradicts the revised decisions.**
   - **(a) design.md:196-200, Decision 4.** It still says the gate "confirms `dataset_rows` row-count parity against the original blob's row count". This is the precondition for the irreversible `config` clear, and it contradicts Decision 2 step 2 and task 1.5 (exact content equality). Reword it to the content-equality guard.
   - **(b) design.md:283-285, Risks.** It still reads "`dataset_rows.data` as an object, not a positional array, is an irreversible storage choice". That is the opposite of Decision 3.
     - Replace it with the positional choice's real trade-off, which is currently unrecorded. Any future column drop, reorder, or insert-in-middle (HEL-1077/1078) must rewrite every row's array in the same transaction as the `dataset_schema` change, or rows silently misalign against the schema.
     - Also state that `dataset_schema` order is load-bearing for `data`.
2. **Add a task for the existing backend test seeds that insert `source_type = 'static'` via raw SQL.**
   - `grep -rn "'static'" backend/src/test --include=*.scala` finds 55 occurrences across 33 files. Examples: `ApiRoutesSpec.scala:1567,3337,3494`, `PipelineAclSpec.scala:111,127`, `PipelineRootRoutesSpec.scala:97,112,250`, `ApiTokenAuthSpec.scala:197`.
   - At least 10 of those files seed non-empty `"rows":[[...` into `config`, for example `PipelineRunRoutesSpec`, `HookRoutesSpec`, `DataSourceRoutesSpec`, and `CombinedApplyProposalSpecBase`.
   - After this migration those inserts fail the new CHECK constraint. Even rewritten to `'dataset'`, their rows sit in `config`, which the swapped readers no longer read. The runs would then silently see zero rows.
   - No task covers this. The task must specify:
     - rewrite the seeds to `'dataset'`, plus `dataset_schema`, plus `dataset_rows` inserts, preferably through one shared test helper rather than 33 hand edits;
     - no assertion may be weakened to accommodate the change;
     - migration-version-pinned specs that target a pre-migration version (e.g. `V98PipelineRootsMigrationSpec`) keep `'static'`, and the executor must confirm which is which rather than bulk-replacing.

### Non-blocking notes
- **Malformed `rows` in Decision 2.** State that a JSON-`null` or non-array `config->'rows'` aborts the migration via `jsonb_array_elements`. It is unreachable from any writer, but a sentence prevents a surprised executor from "fixing" it with a lossy filter. The same applies to `config->'columns'` being JSON `null`, which COALESCE does not catch.
- **Decision 7 and `upsertInferredSchema`.** Say explicitly that `create`/`refresh` still call `upsertInferredSchema` (`DataSourceService.scala:149`) inside the new transaction. "Upsert `dataset_schema` instead of `updateStaticPayload`" could be read as replacing the `inferred_schema` write.
- **`readDatasetRows` consistency.** It reads `dataset_schema` and `dataset_rows` in two statements, so under READ COMMITTED a concurrent refresh can interleave. Consider a single statement, such as a join or a subselect, so schema and rows come from one snapshot.
