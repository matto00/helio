# Files modified (HEL-1480)

One full path per line (squash-branch.sh declaration format); per-file rationale is in citation-sweep.md, mutation-evidence.md and the PR body.

- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala`
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala`
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala`
- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala`
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala`
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjection.scala`
- `backend/src/main/scala/com/helio/services/pipelines/OutputRootResolution.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineAnalyzeReads.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineCreatePreflight.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineCreateTransaction.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineCreateWrites.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineNodeReads.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalAnalyze.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRootWrites.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineServiceSupport.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineStepCreate.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineStepWrites.scala`
- `backend/src/test/scala/com/helio/api/http/ExistenceNotLeakedRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemasSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAclSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/MultiRootIsolationSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepositoryRunTransactionallyRlsSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeAnalyzeWithAiSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeConvertFormatSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeJoinCollisionSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeUpsertSourceSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCycleDetectionServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineServiceCoverageGapsSpec.scala`
