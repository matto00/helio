## Migration

- `backend/src/main/resources/db/migration/V106__dataset_rows.sql` — new migration: creates `dataset_rows` (RLS enable-then-force, bracketed per V94/V96), backfills it + `dataset_schema` from `data_sources.config`, rewrites `source_type` `static` → `dataset` (constraint drop before UPDATE), clears `config`, restores FORCE.

## Backend main

- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` — `rowToDomain`/`domainToRow` map `"dataset"` ↔ `StaticSource`; new `DatasetRowTable`/`DatasetRowRow`, `datasetSchema` column accessor, `insertDatasetSource`, `replaceDatasetRows`, `readDatasetRows` (single-statement LEFT JOIN, privileged pool). Cycle 2 (skeptic-final-1.md CR3): removed the now-dead `updateStaticPayload` (zero remaining callers, wrote to the retired `config` store — a correctness trap for future callers). Cycle 2 (non-blocking note): `replaceDatasetRows` now also updates `inferred_schema` in the SAME transaction and returns `Option[DataSource]` (`None` for a vanished source, restoring the old `updateStaticPayload`'s loud-failure contract). Cycle 2 (CR2): corrected `parseStaticPayload`'s scaladoc (no longer names callers that don't call it).
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — `createStatic`/`applyStaticRefresh` retargeted to `insertDatasetSource`/`replaceDatasetRows` (atomic, canonicalized declared columns); `previewStatic` swapped onto `readDatasetRows`. Cycle 2 (non-blocking note): `applyStaticRefresh` now folds the `inferred_schema` update into `replaceDatasetRows`'s own transaction instead of a separate `upsertSourceDataType` call.
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — static-source row load swapped onto `readDatasetRows`.
- `backend/src/main/scala/com/helio/domain/engine/PipelineRowJson.scala` — `parseStaticRows` overloaded to accept an already-parsed `JsObject` (new post-migration path) alongside the existing raw-string overload.
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — `loadDataFrame`'s static-source branch swapped onto `readDatasetRows`.
- `backend/src/main/scala/com/helio/domain/model/DataSource.scala` — `StaticSource` scaladoc corrected for the post-migration storage reality (Decision 9). Cycle 2 (CR2): the `DataSource` trait-level scaladoc also corrected — it still described the pre-HEL-904 `CsvSourceConfig`/linked-`DataType` storage shape and claimed the DB table shape was unchanged, the exact stale premise HEL-1118 previously traced.

## Backend tests — new

- `backend/src/test/scala/com/helio/testsupport/DatasetRowsTestSupport.scala` — shared test helper seeding `dataset_schema` + `dataset_rows` from a `{columns, rows}` payload.
- `backend/src/test/scala/com/helio/infrastructure/persistence/V106DatasetRowsMigrationSpec.scala` — edge-case migration coverage (`config = '{}'`, duplicate column name, ragged row).
- `backend/src/test/scala/com/helio/infrastructure/persistence/DatasetRowsReaderBehaviorPreservingSpec.scala` — cycle-2 (skeptic-final-1.md CR1): the literal before/after reader-behavior-preservation proof design.md Decision 9 / tasks.md 3.7 require — loads `hel904-real-dump.sql` pre-V106, captures every real `static` source's golden output via the real `PipelineRowJson.parseStaticRows` + a preview projection, migrates, then re-verifies via the real (non-mocked) `DataSourceRepository.readDatasetRows` for every one of them, including the NULL-owner `MyManualSource` and the two `"number"`-typed sources.

## Backend tests — extended

- `backend/src/test/scala/com/helio/infrastructure/persistence/FlywayNonSuperuserMigrationSpec.scala` — added V106 assertions against the real `hel904-real-dump.sql` fixture (non-superuser role, `dataset_rows` FORCE-RLS registration, backfill/parity/config-clear checks for `MyManualSource`).
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala` — new "RLS on dataset_rows" block (owner isolation, privileged bypass, `owner_id IS NULL` invisibility, fail-closed).
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala` — registered `dataset_rows` in the expected-table allowlist.
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceRepositorySpec.scala` — round-trip coverage for the new `"dataset"` stored value and `insertDatasetSource`/`replaceDatasetRows`/`readDatasetRows`. Cycle 2: updated for `replaceDatasetRows`'s new `inferredSchema` param + `Option[DataSource]` return, plus a new "returns None for a nonexistent data source id" case.

## Backend tests — seed migration (`'static'` → `'dataset'`, `readRawConfig` → `readDatasetRows` mock overrides)

- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/ApiTokenAuthSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/alerts/AlertRuleRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/hooks/HookRoutesSpec.scala` — plus `dataset_rows` seed for its blocking-assert fixture.
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — plus `dataset_rows` seed for its backfill/distinct-root-content fixtures.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAclSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalSpecBase.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRootRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` — plus `dataset_rows` seed for `seedDsWithData`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineScheduleRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/proposals/ApplyProposalSpecBase.scala`
- `backend/src/test/scala/com/helio/api/routes/proposals/CombinedApplyProposalSpecBase.scala`
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala`
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala` — mock repo overrides `readDatasetRows` instead of `readRawConfig`.
- `backend/src/test/scala/com/helio/infrastructure/persistence/PipelineSharingAclSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/MultiRootIsolationSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineScheduleRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/V100ZeroRootGuardNonSuperuserSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/V98PipelineRootsMigrationSpec.scala` — mixed: pre-V98-target seeds kept `'static'`, post-`migrateToLatest()` seeds renamed to `'dataset'`.
- `backend/src/test/scala/com/helio/infrastructure/persistence/V99PreventZeroRootPipelinesMigrationSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — plus `dataset_rows` seeds for `seedDsWithData`/`seedDsWithDataIncludingNullScore`/`seedDsWithOtherData`/`seedStaticDs`.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineSchedulerServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineScheduleServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringServiceSpec.scala`
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala` — mock repo overrides `readDatasetRows`; real-DB `submit` fixture seeds `dataset_rows`.

Not touched (version-pinned specs correctly keep `'static'` per design.md Decision 7a — they seed at a Flyway target strictly before V106): `V96CanonicalizeInferredSchemaTypeMigrationSpec`, `TriggerSourceMigrationSpec`, `PipelineOnlyPanelBindingMigrationSpec`, `ResourceTagMigrationSpec`, and the pre-V98-target seeds inside `V98PipelineRootsMigrationSpec`.
