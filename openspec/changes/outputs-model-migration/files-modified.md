# Files modified (cumulative, cycle 19)

This cycle landed task 3.5 (`Pipeline.outputDataTypeId` retirement). Prior cycles' file lists are
in `execution-progress.md`'s history; this file reflects only cycle 19's diff.

## Task 3.5: `PipelineRepository.create` stops minting a DataType

- `backend/src/main/resources/db/migration/V95__pipelines_output_data_type_id_nullable.sql` —
  new migration: relaxes `pipelines.output_data_type_id` to nullable (column stays in place per
  task 2.10, only the NOT NULL constraint is dropped).
- `backend/src/main/scala/com/helio/domain/model/model.scala` — removes `Pipeline.outputDataTypeId`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
  — `create` no longer mints a `DataType`; `PipelineRow.outputDataTypeId`/`PipelineTable` column
  become `Option[String]`; `findSummaryById(Shared)`/`listSummaries` drop the `dataTypesTable`
  join and `PipelineSummary`'s `outputDataTypeName`/`outputDataTypeId` fields; new
  `findOutputDataTypeIdInternal` (privileged read, backs the still-live legacy write path) and
  `setOutputDataTypeIdInternalForTest` (test-only back door for specs exercising that legacy path
  without a production API to wire it).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala` —
  `CreatePipelineRequest`/`PipelineSummaryResponse` drop `outputDataTypeName`/`outputDataTypeId`.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` —
  `PipelineAnalyzeResponse` drops the same two fields (fed from the now-trimmed `PipelineSummary`).
- `schemas/pipelines/pipeline-analyze-response.schema.json` — drops `outputDataTypeName`/
  `outputDataTypeId` from `required`/`properties` to match.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `create` drops the
  `outputDataTypeName` validation/param; `toSummaryResponse`/the `analyze` response builder drop
  the two fields.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala` — `create`
  call site drops the third positional arg; `rollbackAll` drops its now-dangling
  `legacyOutputDataTypeId` param/delete; the public `rollback` and `createPipeline`'s addStep-failure
  branch drop their legacy-DataType cleanup (nothing left to clean up).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — `onRunSuccess`/
  `onUnblockedRunSuccess` take `Option[DataTypeId]` (was required); the legacy schema/row upserts
  are skipped when `None`; the one call site reads the legacy id via the new
  `findOutputDataTypeIdInternal` (the `Pipeline` domain object no longer carries it).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala`,
  `PatchSetPreviewProjection.scala`, `RefinementPrompt.scala` — drop the same two fields from their
  `PipelineSummaryResponse` echoes/prompt text.
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala`,
  `WorkspaceSearchService.scala` — mechanical fallout only (empty-string placeholder / source-only
  description) pending task 3.12's real Outputs rewire of this whole assembler; explicitly
  commented as such, not a scope expansion into 3.12.
- Test fallout (mechanical, same two-field removal / `create` signature change / legacy-DataType
  linking via the new test-only back door): `WorkspaceContextServiceSpec`,
  `WorkspaceSearchServiceSpec`, `WorkspaceTeardownServiceSpec`, `PipelineRunServiceSpec`,
  `PipelineRepositorySpec`, `PipelineAnalyzeRoutesSpec`, `PipelineApplyProposalSpec`,
  `PipelineApplyProposalRollbackSpec` (also adds `nodeSnapshotRowCount` to
  `PipelineApplyProposalSpecBase` replacing the now-dead `GET /api/types/:id/rows` legacy-row
  assertions, and corrects `dataTypeCount()` deltas now that no legacy DataType is minted),
  `CombinedApplyProposalSpec`, `PatchSetApplyServiceSpec`, `PatchSetPreviewServiceSpec`,
  `PatchSetUndoServiceSpec`, `RefinementServiceSpec`, `AlertRuleServiceSpec`,
  `AlertEventServiceSpec`, `AlertEvaluationServiceSpec`, `AlertRuleRepositorySpec`,
  `AlertEventRepositorySpec`, `ResourceTaggingSpec`, `AuditMutationInstrumentationSpec`,
  `AggregatorRegressionSpec`, `SparkJobSubmitterSpec`, `InProcessPipelineEngineSpec`,
  `PipelineRunRoutesSpec`.
