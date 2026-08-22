# Services — Patchsets

Applying a validated edit to an EXISTING artifact (the PatchSet family) plus Refinement (the conversational loop that PRODUCES a PatchSet, distinct from proposals which produce a NEW artifact — see design.md D2).

Holds: `PatchSetApplyForward`, `PatchSetApplyResolvers`, `PatchSetApplyRollback`, `PatchSetApplyServiceJson`, `PatchSetApplyService`, `PatchSetApplyTypes`, `PatchSetPreviewImpact`, `PatchSetPreviewProjection`, `PatchSetPreviewProjectionSteps`, `PatchSetPreviewService`, `PatchSetUndoConflictCheck`, `PatchSetUndoInverse`, `PatchSetUndoService`, `PatchSetUndoTypes`, `RefinementConversationTurns`, `RefinementEditShape`, `RefinementGrounding`, `RefinementParsing`, `RefinementPrompt`, `RefinementService`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/patchsets/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
