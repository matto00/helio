# Files modified (HEL-1839)

Re-derived fail-open list (grep on `features/pipelines`, non-test): `canEdit = true` (PipelineSpine, PipelineSpineHeader, useSpineStepActions), `canRun = true` (SpineStatusStrip, RunHistoryList), `readOnly = false` (StepCardFocused, SpineOutputs, SpineSourceCard, OutputEditorSheet, OutputEditorFooter, OutputSheetPreviewCard, OutputHistoryModal), `isOwner = true` (StepCardFocused), optional `runRole?:` (usePipelineDraftSave). Matches design.md. Production callers all pass the prop (page.canEdit / !page.canEdit / canRunFromUi(runRole) / page.isOwner / runRole).

Every changed path outside the change dir (one explicit path per line; the descriptions above in the earlier version are unchanged in substance):

- `e2e/hel1794-viewer-read-only.spec.ts`
- `frontend/src/features/pipelines/failClosedRoleGuard.test.ts`
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.keys.test.tsx`
- `frontend/src/features/pipelines/hooks/usePipelineDraftSave.dropped.test.tsx`
- `frontend/src/features/pipelines/hooks/usePipelineDraftSave.sessionEpoch.test.tsx`
- `frontend/src/features/pipelines/hooks/usePipelineDraftSave.ts`
- `frontend/src/features/pipelines/ui/RunHistoryModal.test.tsx`
- `frontend/src/features/pipelines/ui/RunHistoryModal.tsx`
- `frontend/src/features/pipelines/ui/RunHistoryModal.viewer.test.tsx`
- `frontend/src/features/pipelines/ui/StepCardFocused.test.tsx`
- `frontend/src/features/pipelines/ui/StepCardFocused.tsx`
- `frontend/src/features/pipelines/ui/failClosedRoleDefaults.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorFooter.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorFooter.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.ask.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.compare.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.configPatch.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.draft.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.fieldTypes.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.heatmapHistogram.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.history.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.insight.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.kindLock.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.labels.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.openingState.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.referenceMarks.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.saveError.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.scatterPickers.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputSheetPreviewCard.tsx`
- `frontend/src/features/pipelines/ui/outputHistory/OutputHistoryModal.test.tsx`
- `frontend/src/features/pipelines/ui/outputHistory/OutputHistoryModal.tsx`
- `frontend/src/features/pipelines/ui/spine/PipelineSpine.test.tsx`
- `frontend/src/features/pipelines/ui/spine/PipelineSpine.tsx`
- `frontend/src/features/pipelines/ui/spine/PipelineSpineHeader.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineOutputs.memoComparators.test.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineOutputs.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineSourceCard.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineStatusStrip.test.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineStatusStrip.tsx`
- `frontend/src/features/pipelines/ui/spine/draftBlocks.test.tsx`
- `frontend/src/features/pipelines/ui/spine/useSpineStepActions.tsx`
- `frontend/src/features/pipelines/ui/viewerCopy.test.ts`
- `frontend/src/test/conditionalFormatsEditorHarness.tsx`
- `frontend/src/test/rawElementGuardHel440.test.tsx`
- `openspec/changes/fail-closed-viewer-edit-defaults/**` — planning artifacts, tasks, evidence/
