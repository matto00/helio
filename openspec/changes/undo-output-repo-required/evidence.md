# HEL-1256 evidence

## (a) Red-first (task 2.5, C2) — observed failure modes
Guard disabled (`case Some(record) if false && context.outputRepo == null && ...`), `sbt "testOnly *PatchSetUndoServiceSpec"`: 16 passed, 2 FAILED (parity and panel-only tests passed).

- Delete with bound Output (`reject a pipelineStep delete with bound Outputs before restoring anything`):
  `expected InternalError(outputRepo unavailable), got Right(PatchSetUndoResponse(Vector(EditUndoOutcome(0,failed,None,None))))`.
  Log: `undo restore failed for edit 0 (kind=pipelineStep, op=delete): ... PatchSetUndoContext.outputRepo() is null`.
  Mode: 200 with outcome `failed`; NPE recovered by `safeRestoreOne`; step recreated without its Outputs (half-restored lane). NOT a 500.
- Create (`reject a pipelineStep create rather than reporting a 0 placement count ...`):
  `java.lang.NullPointerException: ... OutputRepository.listByPipelineInternal(String) because the return value of PatchSetUndoContext.outputRepo() is null`
  at `PatchSetUndoService.countPlacementsForStep(PatchSetUndoService.scala:365)` <- `restorePipelineStepCreate` <- `restoreOne` <- `safeRestoreOne`.
  Mode: unrecovered synchronous NPE escaping `.recover`, failing the outer Future (a 500 at the route).
Guard restored: 75/75 across PatchSetUndoServiceSpec, PatchSetUndoRoutesSpec, Hel914Ac1EndToEndSpec, PatchSetApplyServiceSpec, PatchSetUndoInverseSpec.

## (b) Dereference audit (task 1.3, C3)
Undo-path `outputRepo` reads: `context.outputRepo` in the `undo` guard, `restoreBoundOutputs` (insertInternal), `countPlacementsForStep` (listByPipelineInternal). No bare `outputRepo.` reads. `PatchSetUndoConflictCheck`/`PatchSetUndoInverse` never read it.
Out of scope, collaborator-owned silent skip: `PanelService.scala:635` (`case Some(_) if outputRepo == null => Future.successful(Right(()))`, also :254) skips `PanelService.create`'s outputId-existence check on the placement-restore path. Not changed (non-goal; follow-up with the other services' `= null` defaults).

## (c) Coverage sweep (task 2.6)
Unit: PatchSetUndoServiceSpec, PatchSetUndoRoutesSpec, PatchSetUndoInverseSpec, Hel914Ac1EndToEndSpec, PatchSetApplyServiceSpec exercise undo. LayoutPolicySpec and DashboardServiceLayoutPolicySpec mention undo only in comments/labels (unaffected).
Repo-root e2e/: only hel1028-layout-undo-redo-visual-revert.spec.ts and state-surface-contrast-guard.spec.ts mention undo; both are layout undo, not patch-set undo. No e2e change needed.

## (d) Full suite (task 2.7)
`nice -n 19 sbt testFull` exit 0: Total number of tests run: 5917; succeeded 5917, failed 0. No FirstRunRoutesSpec timeout observed.
