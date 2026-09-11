## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Scope: re-verify the three change requests from skeptic-final-1.md, plus the folded-in non-blocking fix, against the committed HEAD (9a49310a). The round-1 verification of the V106 SQL, RLS, and grants still stands: round 2 did not touch `V106__dataset_rows.sql` (`git show 9a49310a --stat`). The diff has no `frontend/` changes, so the UI gate is not applicable.

### What I verified (with evidence)

**CR1: the before/after proof on the real fixture. It is real.**

I read `backend/src/test/scala/com/helio/infrastructure/persistence/DatasetRowsReaderBehaviorPreservingSpec.scala` in full.

- **Fixture and migration path.** It loads the real `db/fixtures/hel904-real-dump.sql` at V93, as in FlywayNonSuperuserMigrationSpec's recipe, then migrates to V105.
- **Golden capture.** It selects every `source_type='static'` row. It asserts that the NULL-owner `MyManualSource` and the two `"number"`-typed sources (`HEL-315 offers src`, `skeptic-src`) are in the captured set. Golden output comes from the real `PipelineRowJson.parseStaticRows(raw)`, the preview projection, and raw `columns`.
- **After V106.** It migrates to latest and calls the real, unmocked `new DataSourceRepository(new DbContext(postDb, postDb)).readDatasetRows`. It then asserts exact `shouldBe` equality of engine rows (in order), preview headers and strings, and declared columns, for every id. `readDatasetRows` returning None fails the test. It also asserts that no `'static'` rows remain.
- **One inline copy.** `previewProjection` copies `DataSourceService.previewStatic` because that method is private. I diffed the two by reading `DataSourceService.scala:935-952`: the row-string mapping is character-identical, and the header difference (`fields("name")` versus `StaticColumnPayload.name`) is equivalent. The same copy runs on both sides of the comparison, and the reader under test (`readDatasetRows`) is the real one. The `n.toString` stringification means a `2` versus `2.0` drift would be caught. I accept this.
- **The test can fail (mutation check, mine).** I copied `backend/` to my scratchpad, so the worktree was not modified. There I changed `readDatasetRows`'s `sortBy` to `.desc` and re-ran the spec. It went red: `*** FAILED *** [07f57bc4-...] engine rows ... must match pre-migration exactly, in order: Vector(Map(amount -> 30.0), ...) was not equal to Vector(Map(amount -> 10.0), ...)`. So the test exercises the live SQL reader against rows the migration backfilled. It is not a from-a-distance lookalike.
- **The fixture is a meaningful set.** `grep "'static'"` on the dump shows many multi-row static sources with distinct values, including a float column holding `3`, mixed types, and booleans.

**CR2: scaladoc. Fixed.**

- `DataSource.scala:7-29`: the trait doc now describes the dataset_rows/dataset_schema storage, the stored `"dataset"` value versus the wire `"static"`, and a `config` that is unused for dataset sources. It says "7 source kinds", and I counted 7 `extends DataSource`.
- The `StaticSource` doc at :140-158 is consistent with that.
- The `parseStaticPayload` doc no longer names engine, Spark, or protocol callers.
- `grep "linked .DataType"` finds only the corrected "rather than a linked DataType row (the pre-HEL-904 shape)" phrasing.

**CR3: `updateStaticPayload` is removed.**

`grep -rn updateStaticPayload backend/src` finds only two comments: a history note in the `insertDatasetSource` doc, and a test comment. There is no definition and no caller.

**Folded non-blocking fix.**

- `replaceDatasetRows` now writes `(datasetSchema, inferredSchema, updatedAt)` in the same DBIO as the delete and reinsert, then reads the row back, and returns `Option[DataSource]`.
- `applyStaticRefresh` maps None to `NotFound`.
- The inferred-schema value is `fields.map(f => SchemaField(f.name, f.dataType))`, which is identical to what `upsertSourceDataType` → `upsertInferredSchema` wrote (compared at DataSourceService.scala:909-916 and DataSourceRepository.scala:315-323). The behavior is equivalent, and the write is now atomic.

**Gates, run by me.**

- `sbt testOnly` on DatasetRowsReaderBehaviorPreservingSpec, DataSourceRepositorySpec, V106DatasetRowsMigrationSpec, and FlywayNonSuperuserMigrationSpec: 21/21 passed, 4 suites.
- Full `sbt test`: 274 suites, 4066 succeeded, 0 failed, 0 aborted.

### Verdict: CONFIRM

All three round-1 change requests are addressed in the committed code. I verified each from the files themselves. The AC5 proof is a genuine before/after comparison on the real fixture, and a mutation showed it can fail. Together with the round-1 independent verification of V106 and RLS, every AC traces to evidence.

### Non-blocking notes

- `DataSourceRepositorySpec`'s `replaceDatasetRows` test does not assert the newly folded-in `inferred_schema` write. The change is equivalent to the prior write (verified above), but a one-line assertion would guard it.
- Carried from round 1 for HEL-1073/1077: backfilled rows keep raw declared types (`"number"`), while new writes canonicalize them (`float`). This is dormant while Spark is not wired.
- The design text says `elem.ord`, but the code correctly uses `ord - 1`.
