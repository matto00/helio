## Changed files (one bullet per file in the diff against the merge base)

- `openspec/changes/pipeline-root-race-grant-recheck/files-modified.md`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRootRepository.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineWriteAccess.scala`
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoService.scala`
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRootWrites.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineStepCreate.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineStepWrites.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineWriteRefusal.scala`
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftSaveTransaction.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/OutputHistoryPublicRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicProvenanceRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/DraftSaveDeadlockSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/DraftSaveRaceSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/DraftSaveRootsRaceSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputDeleteCurrentAccessRlsSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRootEditorGuardsRlsSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/alerts/AlertRuleRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/OutputDeleteRacesPanelCreateSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineCascadeLockOrderRaceSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRootRemoveAtomicitySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRootWriteGrantsSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala`
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoLaneSpec.scala`
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoLaterAlertRulesSpec.scala`
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoPanelDashboardSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCycleDetectionServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineGrantRecheckRaceSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineServiceCoverageGapsSpec.scala`
- `openspec/changes/pipeline-root-race-grant-recheck/.openspec.yaml`
- `openspec/changes/pipeline-root-race-grant-recheck/design.md`
- `openspec/changes/pipeline-root-race-grant-recheck/evaluation-1.md`
- `openspec/changes/pipeline-root-race-grant-recheck/evaluation-2.md`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m10-output-delete-recheck.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m11-guard-3.1-drop-findByIdOwned.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m12-guard-3.2-delete-scoping-only.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m13-guard-3.2-membership-and-delete-scoping.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m14-guard-4-assertion-target.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m15-revoked-creator-unscoped-read-only.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m16-revoked-creator-unscoped-read-and-r2-neutralised.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m1a-head-read.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m1b-lock-boolean-and-predicate-gone-permitted.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m1b-lock-boolean-only.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m2-root-add-recheck.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m3-root-remove-recheck.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m4-draft-save-recheck.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m5-attach-recheck.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m6-splice-recheck.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m7-update-recheck.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m8-reorder-recheck.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/evidence/mutation-m9-delete-recheck.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/proposal.md`
- `openspec/changes/pipeline-root-race-grant-recheck/red-run-addendum-reorder.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/red-run.txt`
- `openspec/changes/pipeline-root-race-grant-recheck/skeptic-design-1.md`
- `openspec/changes/pipeline-root-race-grant-recheck/skeptic-design-2.md`
- `openspec/changes/pipeline-root-race-grant-recheck/skeptic-final-1.md`
- `openspec/changes/pipeline-root-race-grant-recheck/specs/output-routes-api/spec.md`
- `openspec/changes/pipeline-root-race-grant-recheck/specs/pipeline-editor-grant-recheck/spec.md`
- `openspec/changes/pipeline-root-race-grant-recheck/specs/pipeline-root-write-access/spec.md`
- `openspec/changes/pipeline-root-race-grant-recheck/tasks.md`
- `openspec/changes/pipeline-root-race-grant-recheck/ticket.md`

## Notes (prose)

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineWriteAccess.scala` — NEW: D1 in-transaction owner-or-editor predicate (`currentAction`/`requireAction`), `WriteAccess`, typed `PipelineWriteAccessRevoked`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineWriteRefusal.scala` — NEW: maps the typed refusal to the route's 403/404 (D2 table)
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRootRepository.scala` — D4 `.headOption` + false-lock-Boolean -> `PipelineGone`; re-check in `add`; required `actor` on `removeRoot`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — re-check after lock (3) in attachTail, spliceInsertReporting, update (`lockPipelineOfStepRechecked`), reorderTrunk, delete (each attempt), removeRootCascadeAction; required `actor` params (insertInternal/insertAtInternal/reorderInternal untouched: no production callers)
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala` — D5 re-check in `deleteWithPanelsInternal` / `deleteIfUnboundInternal` (required `actor`)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRootWrites.scala` — recover `PipelineGone` -> 404, typed refusal before generic handlers
- `backend/src/main/scala/com/helio/services/pipelines/PipelineStepWrites.scala` — pass `user` as actor; typed-refusal recover (deleteStep gains a narrow one)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineStepCreate.scala` — pass `user` as actor; typed-refusal recover
- `backend/src/main/scala/com/helio/services/pipelines/draft/DraftSaveTransaction.scala` — re-check right after `abortIf(!locked)` (covers undo restore via saveCore)
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — pass `user`; refusal -> 404 "Output not found" (never 403)
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoService.scala` — pass `user`; refusal -> NotFound "Output not found"
- Tests (new): `backend/src/test/scala/com/helio/services/pipelines/PipelineGrantRecheckRaceSpec.scala`, `.../api/routes/pipelines/OutputDeleteCurrentAccessRlsSpec.scala`, `.../api/routes/pipelines/PipelineRootEditorGuardsRlsSpec.scala` (GUARDS 3.1/3.2)
- Tests (extended): `.../infrastructure/persistence/pipelines/PipelineRootWriteGrantsSpec.scala` (GUARDS item 4: UPDATE on panels, EXECUTE + proowner of hel1629_lock_pipelines)
- Tests (mechanical `actor` argument): DraftSaveDeadlockSpec, DraftSaveRaceSpec, DraftSaveRootsRaceSpec, OutputRoutesSpec, OutputHistoryPublicRoutesSpec, PublicProvenanceRoutesSpec, AlertRuleRepositorySpec, OutputDeleteRacesPanelCreateSpec, PipelineCascadeLockOrderRaceSpec, PipelineRootRemoveAtomicitySpec, PipelineStepRepositorySpliceSpec, V94OutputsMigrationSpec, PatchSetUndoLaneSpec, PatchSetUndoLaterAlertRulesSpec, PatchSetUndoPanelDashboardSpec, PipelineCycleDetectionServiceSpec, PipelineRunServiceSpec, PipelineServiceCoverageGapsSpec
- `openspec/changes/pipeline-root-race-grant-recheck/red-run.txt` — red run on unmodified main, committed first (pre-commit accepted it: it contained no test files); `evidence/mutation-*.txt` — mutation runs

Production call sites of the re-checked writers (all pass the acting `AuthenticatedUser`):
- `PipelineRootWrites.attachRoot` -> `PipelineRootRepository.add(.., user)`; `PipelineRootWrites.removeRoot` -> `PipelineRootRepository.removeRoot(.., user)` -> `PipelineStepRepository.removeRootCascadeAction(.., actor)`
- `PipelineStepWrites.updateStep/deleteStep/reorderSteps/duplicateStep`, `PipelineStepCreate` -> `updateInternal/deleteInternal/reorderTrunkInternal/spliceInsertAtInternal(->spliceInsertReportingInternal)/attachTailInternal` with `actor = user`
- `OutputService.delete` -> `deleteWithPanelsInternal(id, user)`; `PatchSetUndoService.deleteCreatedOutput` -> `deleteIfUnboundInternal(id, user)`
- Draft save: `DraftSaveTransaction.run` uses its existing `actor`.

Mutation evidence notes: removing only the lock-Boolean check at root add stays GREEN (the predicate's PipelineGone catches it: defence in depth); removing it AND mapping PipelineGone to permitted goes RED. Guard 3.2: removing only the `removeAction` pipelineId scoping stays GREEN (the phase-1 membership check still refuses); defeating both goes RED. Grant-spec guards were mutated by changing the assertion target (the harness role `helio_privileged` cannot REVOKE its own grants). Output delete on a downgraded creator answers 404 (never 403) per D2.
Race-only outcome changes for the PR body: reorder and step create on a pipeline deleted mid-request answer the table's 404 (was 422 / database-error); visible non-race change: a creator downgraded to viewer can no longer delete the Output (404) nor undo-delete it.

Cycle 2: reorder race cases now send the valid permutation Seq(t4, t2, t1) (the original Seq(t4, t1) was a 422 on main, so red-run.txt's reorder lines were red for the wrong reason); corrected red evidence is `red-run-addendum-reorder.txt` (write lands on main). All `evidence/mutation-*.txt` re-recorded with the one-line change applied; m8 shows `Right(Vector(...))`. Undo test now asserts the edit reports "failed"; added a fully-revoked-creator Output delete case; fixed import order in DraftSaveTransaction.scala.

Final-gate fix: the revoked-creator `DELETE /api/outputs/:id` case was ALREADY 404 before this change (the service's RLS-scoped `outputRepo.findById` cannot see the Output once the grant is gone). It is now labelled GUARD and moved into the guard block; only the downgraded-to-viewer case is the visible R2 behaviour change. Evidence: m15 (unscoped read alone) green; m10 (R2 re-checks neutralised alone) leaves it green; m16 (both) turns it red.
