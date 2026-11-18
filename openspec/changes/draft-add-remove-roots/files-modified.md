# Files modified (HEL-1734)

Lane-private database for the live e2e run: `helio_hel1734` (drop it at Delivery). No migration was needed (no V143).
Concurrent-lane overlap: none of `model.scala` `OutputKind`, `pipelines.ts`, `outputs.ts`, `pipelineProposal.ts`, `types.ts`, `PatchSetTargetFingerprint` was touched.

## Backend
- `backend/src/main/scala/com/helio/api/protocols/pipelines/DraftSaveProtocol.scala` — `roots`, `rootClientId`, `confirmCascade.rootIds`, `impact.rootIds`, `definition.roots`
- `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala` — 422 body carries `impact.rootIds`
- `backend/src/main/scala/com/helio/services/ServiceError.scala` — `CascadeImpact.rootIds`
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftDiff.scala` — root pass (resolve, order, final positions, removed roots, rootClientId)
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftSaveTransaction.scala` — lock site (0), subset guard, in-transaction cycle check, root apply order, cascade gate, audit
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftSaveService.scala` — caller-owned added sources (404), roots in the response
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftSaveJournal.scala`, `DraftRestore.scala` — `rootDefs`, restore of roots
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftDefinitionReads.scala` — `definition.roots`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineDraftWrites.scala` — `lockAddedSources`, `insertRoots`, `deleteRoots`, `placeRoots`, `RootWrite`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineDefinitionLocks.scala` — `SaveRootSources`, `SaveRootSourcesFirst`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineCycleGuard.scala` — `checkAddedReadsHoldingLockAction`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala` — `rootsAction`
- `schemas/pipelines/draft-save-request.schema.json`, `draft-save-response.schema.json`, `draft-cascade-required-response.schema.json`
- `shared-test-fixtures/draft-save/*.json`

## Backend tests
- `DraftSaveRootsApiSpec`, `DraftSaveRootsUndoSpec`, `DraftSaveRootsRaceSpec` (new); `DraftSaveDeadlockSpec`, `DraftDiffSpec`, `DraftSaveSeamSpec`, `SourceScopedSampleRoutesSpec` (extended)

## Frontend
- `frontend/src/features/pipelines/state/draftOps.ts`, `draftOutputs.ts`, `draftRoots.ts` (new), `pipelineDraft.ts`, `keptDraft.ts`, `pipelinesSlice.ts`
- `frontend/src/features/pipelines/types/draftSave.ts`, `services/draftSaveService.ts`
- `frontend/src/features/pipelines/hooks/`: `draftSaveRequest.ts`, `usePipelineDraft.ts`, `usePipelineDraftRouting.ts`, `usePipelineDetailPage.ts`, `usePipelineDetailStepActions.ts`, `usePipelineDraftSave.ts`, `usePipelineDraftAdopt.ts`, `usePipelineDraftSettle.ts`, `usePipelineDraftUndo.ts`, `usePipelineDraftFrames.ts`, `usePipelineDraftPresentation.ts`
- `frontend/src/features/pipelines/ui/`: `spine/PipelineSpine.tsx`, `spine/SpineSourceCard.tsx`, `mobile/MobilePipelineHeader.tsx`, `PipelineDraftDialogs.tsx`
- Tests: `draftRoots.test.ts`, `draftSaveRequest.roots.test.ts` (new) and updates to the existing draft, keptDraft, slice-export, contract and block-reason tests
- `e2e/hel1734-draft-roots.spec.ts`

## Docs
- `docs/live-draft-preview.md` (8.3.1: lock site (0) in the save, root-row writes after (5)), `openspec/changes/draft-add-remove-roots/evidence/`

## Full path list (for squash-branch.sh)
- `backend/src/main/scala/com/helio/api/protocols/pipelines/DraftSaveProtocol.scala`
- `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineCycleGuard.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineDefinitionLocks.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineDraftWrites.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
- `backend/src/main/scala/com/helio/services/ServiceError.scala`
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftDefinitionReads.scala`
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftDiff.scala`
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftRestore.scala`
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftSaveJournal.scala`
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftSaveService.scala`
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftSaveTransaction.scala`
- `backend/src/test/scala/com/helio/api/protocols/DraftSaveSeamSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/DraftSaveDeadlockSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/DraftSaveRootsApiSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/DraftSaveRootsRaceSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/DraftSaveRootsUndoSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/sources/SourceScopedSampleRoutesSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/draft/DraftDiffSpec.scala`
- `docs/live-draft-preview.md`
- `e2e/hel1734-draft-roots.spec.ts`
- `frontend/src/features/pipelines/hooks/draftSaveRequest.roots.test.ts`
- `frontend/src/features/pipelines/hooks/draftSaveRequest.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.keys.test.tsx`
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDetailStepActions.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDraft.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDraftAdopt.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDraftFrames.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDraftPresentation.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDraftRouting.outputs.test.tsx`
- `frontend/src/features/pipelines/hooks/usePipelineDraftRouting.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDraftSave.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDraftSettle.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDraftUndo.ts`
- `frontend/src/features/pipelines/services/draftSaveService.test.ts`
- `frontend/src/features/pipelines/services/draftSaveService.ts`
- `frontend/src/features/pipelines/services/draftSaveWire.contract.test.ts`
- `frontend/src/features/pipelines/state/draftOps.ts`
- `frontend/src/features/pipelines/state/draftOutputs.ts`
- `frontend/src/features/pipelines/state/draftRoots.test.ts`
- `frontend/src/features/pipelines/state/draftRoots.ts`
- `frontend/src/features/pipelines/state/keptDraft.test.ts`
- `frontend/src/features/pipelines/state/keptDraft.ts`
- `frontend/src/features/pipelines/state/keptDraftListeners.test.ts`
- `frontend/src/features/pipelines/state/pipelineDraft.ts`
- `frontend/src/features/pipelines/state/pipelinesSlice.exports.test.ts`
- `frontend/src/features/pipelines/state/pipelinesSlice.ts`
- `frontend/src/features/pipelines/types/draftSave.ts`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.draftMode.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDraftDialogs.tsx`
- `frontend/src/features/pipelines/ui/mobile/MobilePipelineHeader.tsx`
- `frontend/src/features/pipelines/ui/spine/PipelineSpine.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineSourceCard.tsx`
- `frontend/src/features/pipelines/ui/spine/draftBlocks.test.tsx`
- `schemas/pipelines/draft-cascade-required-response.schema.json`
- `schemas/pipelines/draft-save-request.schema.json`
- `schemas/pipelines/draft-save-response.schema.json`
- `shared-test-fixtures/draft-save/draft-save-cascade-422.json`
- `shared-test-fixtures/draft-save/draft-save-request.json`
- `shared-test-fixtures/draft-save/draft-save-response-run-rejected.json`
- `shared-test-fixtures/draft-save/draft-save-response-run-started.json`
- `shared-test-fixtures/draft-save/draft-save-response.json`
