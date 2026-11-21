# Services — Patchsets

Applying a validated edit to an EXISTING artifact (the PatchSet family) plus Refinement (the conversational loop that PRODUCES a PatchSet, distinct from proposals which produce a NEW artifact — see design.md D2).

Holds: `InlineRootPairing`, `PatchSetApplyForward`, `PatchSetApplyResolvers`, `PatchSetApplyRollback`, `PatchSetApplyServiceJson`, `PatchSetApplyService`, `PatchSetApplyTypes`, `PatchSetDataSourceResolvers`, `PatchSetOutputResolvers`, `PatchSetPanelResolvers`, `PatchSetPipelineResolvers`, `PatchSetPipelineStepResolvers`, `PatchSetPreviewImpact`, `PatchSetPreviewDashboardProjection`, `PatchSetPreviewPanelProjection`, `PatchSetPreviewPipelineProjection`, `PatchSetPreviewProjection`, `PatchSetPreviewProjectionSteps`, `PatchSetPreviewSourceProjection`, `PatchSetPreviewStepProjection`, `PatchSetPreviewService`, `PatchSetRefs`, `PatchSetResolverSupport`, `PatchSetUndoConflictCheck`, `PatchSetUndoDatasetLaterWork`, `PatchSetUndoInlineSources`, `PatchSetUndoInverse`, `PatchSetUndoService`, `PatchSetUndoTypes`, `RefinementConversationTurns`, `RefinementEditShape`, `RefinementGrounding`, `RefinementParsing`, `RefinementPrompt`, `RefinementService`.

Undo guards (refuse with a 409, nothing restored, rather than delete work the patch set did not create): `PatchSetUndoDatasetLaterWork` (HEL-1796) guards a `dataSource` create undo against rows added, replaced or edited and schema edits since the apply (journaled as `JournaledEdit.createdDataset`, with an `appliedAt` fallback for older journal rows) and against later pipeline or form-panel references. It also guards the inline dataset roots of a `pipeline` create (journaled as `JournaledInlineSource.createdDataset`): an unreferenced one with later rows or edits refuses the undo, a still-referenced one is kept (HEL-1493). It runs from `PatchSetUndoConflictCheck.checkOne` (and `guarded`, for inline roots) in Phase 1 and as a re-check before the delete in Phase 2.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/patchsets/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
