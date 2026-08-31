# Files modified — cycle 26 (this cycle)

Section 4 in full: 4.1 (delete `DataTypeRepository`/`DataTypeRowRepository`/`DataTypeService`/
`MetricRepository`/`MetricService`/`DataTypeProtocol`/`api/protocols/metrics/*`/`DataTypeRoutes`/
`MetricRoutes`, and every downstream `dataTypeRepo`/`dataTypeRowRepo`/`metricRepo` constructor
param — including severing `PipelineRunService`'s legacy DataType schema/row writes, the last
known live production consumer), 4.2 (`ApiRoutes.scala`/`Main.scala` wiring removal), 4.3 was
already `[x]` from a prior cycle, 4.4 (`RlsPolicyGuardSpec` table swap), 4.5 (delete every backing
spec for the files 4.1 deleted). Also deleted `schemas/metrics/` ahead of section 5, since 4.1's
`MetricProtocol` deletion left it failing `check-schema-drift.mjs` on its own.

## Main sources

- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — deleted
  `upsertFieldsFromRows`/`schemaUpsert`/`rowsUpsert` (the HEL-891 DataType-schema-union write) and
  `assertionStatusForDataType`; removed `dataTypeRepo`/`dataTypeRowRepo` constructor params and the
  `outputDataTypeId` threading through `onRunSuccess`/`onUnblockedRunSuccess` (no longer needed once
  the DataType writes were gone); rewired the HEL-462 schema-drift baseline capture onto
  `dataSourceRepo.findByIdOwned(...).inferredSchema` instead of the retired
  `dataTypeRepo.findBySourceId` → `deriveSourceSchema` path (mirrors task 4.3's own pattern).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
  — dead `dataTypeRepo` constructor param and `dataTypesTable` field removed.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — dead
  `dataTypeRepo` constructor param removed (flagged as dead in a prior cycle, now actually removed).
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala` —
  `preValidateBindings`/`validateDataTypeBinding`'s `dataTypeRepo` param and non-`"output"`-kind
  DataType-binding branch removed outright (Text/Markdown panels never carry a binding anymore,
  confirmed via `TextPanelConfig`/`MarkdownPanelConfig` having no `dataTypeId` field at all).
- `backend/src/main/scala/com/helio/services/proposals/DashboardProposalService.scala` —
  `dataTypeRepo`/`metricRepo` constructor params removed.
- `backend/src/main/scala/com/helio/services/dashboards/DashboardContentsService.scala` —
  `dataTypeRepo` constructor param removed.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyTypes.scala` —
  `PatchSetApplyContext`'s `dataTypeRepo`/`metricRepo` fields removed (never read after
  construction).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyService.scala` /
  `PatchSetPreviewService.scala` — `dataTypeRepo`/`metricRepo` constructor params removed.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `DataTypeRoutes`/`MetricRoutes` route
  mounts and `dataTypeService`/`metricServiceOpt` construction removed; `dataTypeRepo`/
  `dataTypeRowRepo`/`metricRepo` constructor params removed from the primary `ApiRoutes`
  constructor and threaded out of every downstream service construction site.
- `backend/src/main/scala/com/helio/app/Main.scala` — matching `dataTypeRepo`/`dataTypeRowRepo`/
  `metricRepo` repository construction and `ApiRoutes(...)` call-site argument removal.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — `DataTypeProtocol`/`MetricProtocol`
  mixins removed.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala` —
  `DataTypeProtocol` mixin removed (stale scaladoc claim about `SchemaFieldResponse` living there
  corrected — it never did).
- `backend/src/main/scala/com/helio/api/protocols/PaginationProtocol.scala` — `DataTypeProtocol`/
  `MetricProtocol` mixins and their `pagedDataTypesFormat`/`pagedMetricsFormat` formats removed.
- `backend/src/main/scala/com/helio/api/package.scala` — every `DataTypeResponse`/
  `DataTypesResponse`/`DataFieldPayload`/`ComputedFieldPayload`/`UpdateDataTypeRequest`/
  `ValidateExpressionResponse`/`DataTypeRowsResponse`/`MetricResponse`/`CreateMetricRequest`/
  `UpdateMetricRequest`/`MetricUsagePanelResponse`/`MetricUsageResponse` alias removed.
- **Deleted outright**: `DataTypeRepository.scala`, `DataTypeRowRepository.scala`,
  `DataTypeService.scala`, `MetricRepository.scala`, `MetricService.scala`,
  `DataTypeProtocol.scala`, `api/protocols/metrics/MetricProtocol.scala`,
  `api/protocols/metrics/README.md`, `DataTypeRoutes.scala`, `MetricRoutes.scala`.

## Test sources

- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala` — `4.4`:
  removed `data_types`/`data_type_rows`/`metrics` from the RLS-table allowlist, added `outputs`/
  `node_snapshots`; corrected a stale `binary_refs` comment (re-keyed off `pipeline_id`, not the
  retired `data_type_id`).
- **Deleted outright** (`4.5`): `DataTypeDataSourceAclSpec.scala`, `DataTypeServiceSpec.scala`,
  `DataTypeRoutesSpec.scala`, `MetricRoutesSpec.scala`, `DataTypeRepositorySpec.scala`,
  `DataTypeRowRepositorySpec.scala`, `MetricRepositorySpec.scala`, `ComputedFieldsRoutesSpec.scala`
  (the `/api/types/:id` computed-fields surface, ticket item 8), `MetricProtocolSpec.scala`,
  `DataTypeServiceOverflowStructuredFieldNamesSpec.scala` (its pure function is already inlined +
  covered inside `WorkspaceContextService` itself).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — deleted the
  whole "HEL-891 schema union" describe block (tested the now-deleted `upsertFieldsFromRows`);
  rewired every `dataTypeRowRepo.listRows`/`dataTypeRepo.findByIdInternal` assertion onto a new
  `snapshotRows(pid)` helper reading `node_snapshots` (the surviving row-materialization write);
  `seedSourceDataType`/`updateSourceDataTypeFields` rewired to write `data_sources.inferred_schema`
  directly instead of a companion `data_types` row, matching `PipelineRunService`'s own rewired
  read path (fixed a `SchemaField` field-name mismatch — `type`, not `dataType` — caught by the
  first full-suite run after the rewrite).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` — same
  `dataTypeRepo`/`dataTypeRowRepo` → `nodeSnapshotRepo` rewire for `makeRoutes`'s constructor args
  and every row-content assertion; deleted the one HEL-891 schema-inference test with no surviving
  code path.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — deleted the "DataType CRUD"/
  computed-fields test block and the "DataType ownership enforcement" describe block (both
  `/api/types` surface, now gone); retitled one unrelated test whose title only mentioned
  "registers DataType" without actually exercising it.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala` — deleted
  the metric-deprecation-conflict test and its negative counterpart (metrics no longer exist).
- `backend/src/test/scala/com/helio/services/assistant/AssistantServiceSpec.scala` /
  `AssistantToolExecutorSpec.scala` — replaced the `DataTypeRepository`-mocking adapter
  (`dataTypeBackedOutputRepo`/`toOutput`) with direct `OutputRepository` mocks, since
  `OutputRepository` is itself mockable now that there's no `DataTypeRepository` stand-in to keep
  around.
- `backend/src/test/scala/com/helio/services/proposals/DashboardProposalServiceValidateSpec.scala`
  — dropped the now-always-unused `dtRepo` mock/param from every test.
- All other modified test files: mechanical removal of dead `dataTypeRepo`/`dataTypeRowRepo`/
  `metricRepo`/`dataTypeService`/`metricService` fields, imports, and constructor arguments, OR
  (where a fixture genuinely needed a `data_types` row to satisfy `pipelines.
  output_data_type_id`'s still-live FK) a rewire onto a raw-SQL insert against `data_types`
  directly, since `DataTypeRepository` no longer exists to do it for them
  (`WorkspaceContextServiceSpec`, `WorkspaceSearchServiceSpec`, `WorkspaceTeardownServiceSpec`,
  `DashboardAuthoringServiceSpec`, `SourceSchemaHealthCheckSpec`, `ResourceTagMigrationSpec`,
  `DataSourceServiceRestartPersistenceSpec`).

## Schemas

- **Deleted outright**: `schemas/metrics/create-metric-request.schema.json`,
  `schemas/metrics/metric.schema.json`, `schemas/metrics/metric-usage-response.schema.json`,
  `schemas/metrics/update-metric-request.schema.json` — pulled forward from task 5.1 because 4.1's
  `MetricProtocol` deletion left them failing `check-schema-drift.mjs` on their own; the gate must
  be green on every commit. `schemas/data-types/` is untouched — its one file's backing case class
  (`AssertionStatusResponse`) was never DataType-specific, so the drift check doesn't flag it, and
  its move to `schemas/outputs/` stays task 5.1's own job.

## OpenSpec

- `openspec/changes/outputs-model-migration/tasks.md` — marked 4.1/4.2/4.4/4.5 `[x]`, noted 5.1's
  partial completion (schemas/metrics/ only).
