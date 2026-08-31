# Files modified — cycle 26 (task 2.10: drop metrics/data_types/data_type_rows/output_data_type_id + panels' retired columns)

## Migration

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — appended sections 17-21:
  `panels.kind SET NOT NULL`; drop panels' 14 retired columns (`type, type_id, field_mapping,
  aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options,
  timeline_options, column_widths, table_density, column_order, chart_annotation`); drop
  `pipelines.output_data_type_id`; drop `alert_rules`/`alert_events.target_data_type_id` (the
  former FK-referenced `data_types`, blocking its drop); replace `binary_refs_owner`'s RLS
  policy (was keyed on `data_type_id -> data_types.owner_id`) with a
  `pipeline_id`/`helio_can_access_pipeline`-keyed one, then drop `binary_refs.data_type_id`;
  drop `metrics`, `data_type_rows`, `data_types` (in that FK-dependency order).

## Backend main — code changes required to unblock the drops

- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowMapper.scala` —
  `domainToRow` now always sets `kind = p.kind` (was `None` for every non-Output panel);
  `rowToDomain` dispatches purely on `row.kind` (was falling back to the about-to-be-dropped
  `type` column for text/markdown/image/divider). Closes a gap task 3.6 had deferred but never
  actually landed.
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala` —
  `PanelTable`/`PanelRow`/`configColumnsOf`/`configColumnValuesOf` slimmed to the 6 surviving
  config columns; `kind` is now `String` (NOT NULL), not `Option[String]`.
  `type`/`type_id`/`field_mapping`/`aggregation`/`metric_label`/`metric_unit`/`column_widths`/
  `table_density`/`column_order`/`chart_options`/`collection_options`/`timeline_options`/
  `chart_annotation`/`metric_id` columns removed entirely.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
  — removed `outputDataTypeId` from `PipelineRow`/`PipelineTable`/`create`;
  `setOutputDataTypeIdInternalForTest`/`findOutputDataTypeIdInternal` deleted outright (dead,
  zero production callers survived task 4.1).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala`
  — `findLatestRunIdByOutputDataTypeIdInternal` deleted outright (dead, zero production callers).
- `backend/src/main/scala/com/helio/app/SourceSchemaHealthCheck.scala` — deleted outright
  (HEL-256's entire purpose, flagging a `data_sources` row with no linked `data_types`
  companion, is meaningless once the companion-DataType concept is gone).
- `backend/src/main/scala/com/helio/app/Main.scala` — removed the `SourceSchemaHealthCheck.run`
  boot-time call site.

## Backend test — deleted outright

- `backend/src/test/scala/com/helio/app/SourceSchemaHealthCheckSpec.scala` — deleted (its
  subject no longer exists).

## Backend test — fixture rewrites (drop dead `data_types`/`output_data_type_id`/panels'
retired-column references from raw-SQL fixtures; `RlsOwnerTablesSpec`/`RlsPrivilegedDmlSpec`
also drop their now-meaningless "DML/RLS on data_types(_rows)" describe-blocks)

- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/ApiTokenAuthSpec.scala`
- `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/alerts/AlertRuleRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardPanelAclSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/hooks/HookRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAclSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalRollbackSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalSpecBase.scala` —
  also removed `dataTypeCount()`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineScheduleRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/proposals/ApplyProposalSpecBase.scala` — also
  removed `seedMetric` (dead, `metrics` dropped).
- `backend/src/test/scala/com/helio/api/routes/proposals/CombinedApplyProposalSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/proposals/CombinedApplyProposalSpecBase.scala` —
  also removed `dataTypeCount()`.
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/BinaryRefsMigrationSpec.scala` —
  updated expected column set (drops `data_type_id`), replaced the two `data_type_id`-keyed
  index tests with a policy-existence check.
- `backend/src/test/scala/com/helio/infrastructure/persistence/PaginationSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/PipelineSharingAclSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala` —
  deleted "RLS on data_types" describe-block + `seedDataType` helper.
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPrivilegedDmlSpec.scala` —
  deleted "DML on data_types"/"DML on data_type_rows" describe-blocks.
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsSharingAwareTablesSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/alerts/AlertEventRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/alerts/AlertRuleRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/panels/PanelRowMapperSpec.scala`
  — assertions rewired from `row.panelType`/`row.typeId`/`row.fieldMapping` onto `row.kind`.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/BinaryRefRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepositorySpec.scala`
  — deleted `seedPipelineWithDataType` + the 4-test `findLatestRunIdByOutputDataTypeIdInternal`
  describe-block (dead method).
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineScheduleRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala`
  — new "V94 task 2.10" describe-block (8 red-first drop assertions via `information_schema`/
  `pg_policies`); adapted the two now-stale post-migration `data_types` count assertions and the
  two task-2.7/2.8 tests that inserted fresh rows against columns this same migration file now
  drops.
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceRepositorySpec.scala`
- `backend/src/test/scala/com/helio/services/alerts/AlertEvaluationServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/alerts/AlertEventServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/alerts/AlertRuleServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineScheduleServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineSchedulerServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringServiceSpec.scala` —
  removed two vestigial `data_types` insert/`db.run()` calls that had zero effect once
  `outputDataTypeId` no longer resolves through the DB.
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceRestartPersistenceSpec.scala`
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/sources/SchemaInferenceRegressionSpec.scala`
- `backend/src/test/scala/com/helio/services/sources/SourceServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala` —
  removed the vestigial companion-`data_types` insert + `setOutputDataTypeIdInternalForTest`
  call (already fully superseded by the real Output created in the same helper).
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceSearchServiceSpec.scala` — same.
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceTeardownServiceSpec.scala` —
  same, plus simplified `SeededPipeline` to drop its unused `outputDataTypeId` field.
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala`

## OpenSpec

- `openspec/changes/outputs-model-migration/tasks.md` — task 2.10 marked `[x]` with full
  rationale.
- `openspec/changes/outputs-model-migration/files-modified.md` — this file.
- `openspec/changes/outputs-model-migration/execution-progress.md` — new cycle-26 section.

## Explicitly NOT touched (verified, left alone)

- `backend/src/test/scala/com/helio/infrastructure/persistence/ResourceTagMigrationSpec.scala`,
  `TriggerSourceMigrationSpec.scala`, `PipelineOnlyPanelBindingMigrationSpec.scala` — all three
  pin an OLDER Flyway `.target(...)` (V72/V93, V62, V93 respectively), so their
  `data_types`/`output_data_type_id`/`type_id` fixtures are legitimate at that schema version.
  An automated first-pass script wrongly stripped these; caught via a `.target(` sweep before
  running the suite and `git checkout`-reverted rather than hand-repaired.
