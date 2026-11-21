# HEL-1798 post-await sites in `frontend/src/features/pipelines/hooks/`

Derived on 98b8c40e9 from (a) `post-await.sh` (literal `dispatch(` within 30 lines of an `await`/`.then(`), (b) a grep for
calls to dispatching helpers (`syncStepsFromServer`, `refreshRunHistoryAfterRun`, `refreshVisibleOutputPreviews`,
`settleSaved`, `loadRunHistoryWhenTruncated`, `onStepsSettled`, `onOutputsSettled`) across every non-test file in the
directory, and (c) a read of every `await`/`.then` in the eight hooks for direct service calls. Every row of design.md's
table is present; no in-scope site beyond it was found (no escalation).

Disposition: GATED = this change; SAFE = no dispatch/helper/service request follows the await; OUT = outside the eight hooks.

## The eight hooks

| Hook | Site (line on 98b8c40e9) | Disposition |
| --- | --- | --- |
| usePipelinePageLoad | mount effect `.then` -> `onStepsSettled` (67-69) | GATED |
| usePipelinePageLoad | mount effect `.then` -> `onOutputsSettled` (75-77) | GATED |
| usePipelinePageLoad | `retryStepsLoad` `.then` -> `onStepsSettled` + `analyzePipeline` (142-146) | GATED |
| usePipelinePageLoad | lines 66, 70, 71, 103, 122: dispatched synchronously, before any await | SAFE (dispatch-before-await) |
| usePipelineStepStructure | `handleAddOutputViaAggregateTail`: `syncStepsFromServer` (124), `createOutput` (126), `fetchOutputs` (132), `previewOutput` (136) | GATED |
| usePipelineStepStructure | `syncStepsFromServer` after its `unwrap()` (59-70): `setSteps` only | SAFE (local state of an unmounted page) |
| usePipelineDraftSave | `draftSaveRunPending` after `getPipelineWithDefinition` (164) | GATED |
| usePipelineDraftSave | `settleSaved` after `saveDraft` (170) (dispatches `draftSaveRunSettled`, `fetchPipelineById`, adopt, history/preview refresh) | GATED |
| usePipelineDraftSave | `draftSaveRunSettled` in `catch` (173) | GATED (only that dispatch; `finally` always runs) |
| usePipelineDraftSave | `reload`: `adoptDefinition` after `getPipelineWithDefinition` (229-232) | GATED |
| useOutputImmediateActions | `previewOutput` after `createOutput(...).unwrap()` (35) | GATED |
| useOutputImmediateActions | `update`/`remove` (38, 41): nothing follows the unwrap | SAFE |
| useRunHistory | `loadWhenTruncated` `.then` -> `fetchPipelineRunHistory` (106) | GATED |
| usePipelineRootAndToggleActions | `handleDuplicateStep`: `syncStepsFromServer` after `duplicatePipelineStep` (161) | GATED |
| usePipelineRootAndToggleActions | `handleAddRoot`: `fetchPipelineById` after `addPipelineRoot` (63-64) | GATED (`mountedRef` kept, epoch added) |
| usePipelineRootAndToggleActions | `handleRemoveRoot`: `fetchPipelineById` + `syncStepsFromServer` (85-87) | GATED (`mountedRef` kept, epoch added) |
| usePipelineRootAndToggleActions | `handleToggleStepEnabled` (115-120): `setSteps` only | SAFE |
| usePipelineStepMutations | `handleRemoveStep`: `syncStepsFromServer` in the `deletePipelineStep` `.then` (77-88) | GATED |
| usePipelineStepMutations | `handleReorderSteps`: `setSteps` after `reorderPipelineSteps` | SAFE |
| usePipelineRunAndSaveActions | `handleRunPipeline` / `handleDryRun`: `refreshRunHistoryAfterRun()` + `refreshVisibleOutputPreviews(id)` after `unwrap()` (74-76, 87-89) | GATED |
| usePipelineRunAndSaveActions | `handleSave`: `navigate("/pipelines")` after `updatePipeline`, no id, no request | SAFE |

## D3 caller check (`handleAddOutputViaAggregateTail` rejection)

`usePipelineDraftRouting.ts:243` returns the handler's promise unchanged; `PipelineDetailDialogs.tsx:56` passes it as
`onAddAsTailWithAggregate`; `ui/outputEditor/OutputEditorSheet.tsx:274-283` awaits it in `try { ... } catch {
setSaveError("Failed to add tail with aggregate.") } finally { setSaving(false) }`. A throw is therefore handled as a failed save.

## Outside the eight, safe

| File | Site | Disposition |
| --- | --- | --- |
| usePipelinePreviewCache.ts:27, 41 | `previewOutput` / `previewUnsavedOutputStep` | SAFE: both callbacks dispatch before their only await and nothing runs after it |

## Out of scope (follow-up candidates, not edited)

| File | Site | Note |
| --- | --- | --- |
| usePipelineDraftUndo.ts:57 | `fetchPipelineById` after an await | sibling lane HEL-1792 |
| usePipelineDraftSettle.ts:99-107 | `fetchPipelineById`, history and preview refresh | only reached through `settleSaved`, which is now gated at its call site in `usePipelineDraftSave` |
| usePipelineDraftCreate.ts:70 | flush after await | follow-up candidate |
| usePipelineShapeInstantiation.ts:83-103 | create loop of service calls after awaits | follow-up candidate |
| usePipelineRunStream.ts:75 | SSE terminal handler -> `refreshRunHistoryAfterRun` | follow-up candidate; the stream is torn down on unmount (sign-out unmounts the page) |
