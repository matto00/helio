## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: c939f378146d5614be8e8c4cc12b9466dae08b15 (the change dir is untracked). I took owner rulings Q1/Q2/Q3 as given. I derived everything below from the tree. I read earlier rounds only to avoid duplicating their requests. Both of round 2's change requests are addressed: D2 variant (a) now has a spy `overwriteRows` call count, and D4 now has an injected render observer.

### What I verified (with evidence)

**HEL-1707 primitives**
- `PipelineWriteAccess.currentAction/requireAction` (infrastructure/persistence/pipelines/PipelineWriteAccess.scala) uses explicit predicates: the owner, else the caller's own `resource_permissions` row. `mayWrite` is true for Owner or Editor.
- `PipelineWriteRefusal.refused/toError` maps Viewer to `Forbidden("Forbidden")` and everything else to the caller's not-found.

**D1 (Output create)**
- `insertInternal` is at OutputRepository.scala:234-254: `withSystemContext(lockPipelines(OutputCreate) andThen insertInternalAction).transactionally`. `OutputRepository` takes injectable `locks` (:28).
- Its production callers are OutputService.scala:159 and PatchSetUndoRestorers.scala:176 only. `insertInternalAction`'s other caller is PipelineCreateTransaction.scala:195, which is left unchanged.
- The pre-check (OutputService.scala:146-149) answers Viewer with `Forbidden()` and a stranger with `NotFound("Pipeline not found")` (AccessCheckerImpl `requireAccess`, `None` branch).
- `RaceLocks` (PipelineGrantRecheckRaceSpec.scala:27) fires its racer inside the write's transaction, before the lock. Under READ COMMITTED both races are red on main for the stated reason: the privileged insert lands.
- The refusal is routed through `PipelineWriteRefusal`, so no `ServiceError.Forbidden(` producer is added.
- Undo of a step delete: `PatchSetUndoService` recovers `NonFatal` into an edit-level error (PatchSetUndoService.scala:109). A refusal in `restoreBoundOutputs` is therefore not a 500.
- The undoer reaches `restoreBoundOutputs` only after `pipelineService.addStep` succeeds, and that step write is already checked by HEL-1707. So D1 changes nothing outside the race.

**D2 (backfill)**
- `evaluateNodeRowsForBackfill` (PipelineRunBackfill.scala:102-103) reads `findByIdShared`, which admits a viewer. `persistBackfilledRowsWithinLimit` (:162-179) calls `overwriteRows` with no guard, then `updateSchemaInternal` in separate privileged transactions.
- `overwriteRows` (NodeSnapshotRepository.scala:109-116) accepts `guard` and runs it as the transaction's first action (:156-164). With the racer committed before delegation, variant (b) is red on main and pinned by `guard = None`.
- Variant (a) is pinned by the zero-calls spy: with the start check removed, `overwriteRows` is called once and the guard refuses.
- `PipelineRepository` (:15) and `NodeSnapshotRepository` (:88) are non-final.
- Neither `OutputService.create` nor `PipelineRunService.backfillOutputNode` (:272-282) calls `findByIdShared` before the backfill does. An armed one-shot racer therefore fires at the intended point.

**D3 (Output PATCH)**
- `OutputService.update` (:225-270) runs `findById`, then `findConfigById`, then `updateOwned`. `updateOwned` (OutputRepository.scala:300-322) runs on `withUserContext`, which is app pool plus `setUserVar`, transactional (DbContext.scala:50-51). The empty body goes to `findByOwned`.
- RLS policies:
  - `outputs_select` is `helio_can_access_pipeline(pipeline_id)` and `outputs_update` is creator-only (V94:238-248).
  - `pipelines_select` is `helio_can_access_pipeline(id)` (V39).
  - `resource_permissions_pipeline_select` lets the grantee read their own row, and the owner read all rows for the pipeline (V39).
  - No migration contains `RESTRICTIVE`.
- So `requireAction` run in user context resolves as follows: a downgraded creator gets `Viewer` (refused), a revoked creator gets `PipelineGone` (refused), and the owner and an editor are admitted. A downgraded creator passes both `outputs_select` and `outputs_update`, so the downgrade case is red on main (200), and the revoke race is correctly a GUARD.
- `TwoUserRlsApiFixture` really is NOBYPASSRLS (:131 `helio_app_test NOSUPERUSER NOBYPASSRLS`, privileged pool `helio_privileged`, :147-149).
- `OutputService.update` callers: OutputRoutes.scala:114, PatchSetApplyForward.scala:105 and PatchSetApplyRollback.scala:186. There is no `("output","update")` undo case (PatchSetUndoService.scala:122-135).
- No existing test pins "PATCH unchanged for a downgraded creator" (grep of backend/src/test), so X2 does not silently contradict an existing guard.

**D4 (insight refresh)**
- `refresh` (InsightRenderService.scala:106-115) calls `startRender` inside `access.resolve(..).map`.
- `renderGuarded` (:185-217) reads the pipeline with `findByIdInternal`, writes `noSend` rows, then `proceed` charges `quotaGate.checkAndIncrement(pipeline.ownerId, ..)` before `send`. There is no access check after admission, so the race is red on main.
- `inFlight` is released by `startRender`'s `andThen` when there was no hand-off. `RenderResult` is sealed (:349-355).
- The only `automatic = false` caller is :111. The run (:97) and tick (:162) paths are untouched.

**Non-race behaviour.** `currentAction` follows the same owner/role rule as `AccessCheckerImpl.requireAccess`. For owners and current editors, D1, D2 and D4 change nothing. The only non-race change is X2, together with the backfill that a downgraded creator's PATCH used to trigger. That matches Q2.

**Spec deltas.** The MODIFIED header `DELETE /api/outputs/:id requires current pipeline edit access` matches openspec/specs/output-routes-api/spec.md:594 verbatim. The ADDED requirements do not collide with the existing requirement names in pipeline-editor-grant-recheck or insight-render-triggers.

**Mutation coverage.** Every production check added has a planned test that a named mutation turns red:
- D1: the in-tx check (1.2) and the Viewer->403 mapping (1.2, downgrade).
- D2: the start check (1.3a, spy count) and the in-tx guard (1.3b).
- D3: the name branch and the empty-body branch (1.4), plus the 404 mapping.
- D4: the start check (1.5, observer result plus zero sends/rows).

### Verdict: REFUTE

The design is sound and its facts hold on the tree. One internal contradiction between design.md and tasks.md remains. An executor following the plan literally cannot satisfy it, and an evaluator checking task 1.6 mechanically would fail a correct execution.

### Change Requests

1. **The D4 red test cannot exist "before any src/main change" or "on main c939f3781".** Affected: tasks.md 1.5 and 1.6, and design.md D5's closing paragraph.
   - D5 (D4 bullet) requires production seams before the red test can compile:
     - the constructor-injected render observer on `InsightRenderService`, which is a production change listed in files-modified.md;
     - possibly dropping `final` on `InsightAccess` (InsightAccess.scala:13).
   - Task 1.6 says the red-run commit must exist "before any src/main change", and D5 says "Each red test must be red on main c939f3781". Both cannot hold for 1.5.
   - Revise so the plan admits a behaviour-neutral seam commit before the red run:
     - the observer defaulting to a no-op;
     - `final` dropped, or no change at all if the racer seam is a test `AccessChecker` wrapper. `InsightAccess` takes the `AccessChecker` trait, so a wrapper whose `requireAccess` delegates and then commits the racer needs no production change.
   - That commit must carry no check and no behaviour change. Redefine "red on main" for 1.5 as "red on c939f3781 plus the seam-only commit, for the stated reason".
   - Reword 1.6 to "before any production check or refusal-mapping change". Have files-modified.md name the seam commit separately.
   - Also order task 2.0 (the test-only `RaceLocks` extraction) before 1.2, which depends on it.

### Non-blocking notes

- **D2 test precondition.** `backfillOutputNode` is a no-op when the node already has a snapshot (PipelineRunBackfill.scala:76-78), not only when no run has succeeded. 1.3's setup needs a node with a successful pipeline run but no snapshot: for example an Output on a step added after the run, or snapshot rows deleted. Otherwise the "red" is green on main for the wrong reason.
- **D2/D4 fixture.** The design pins the NOBYPASSRLS fixture for D3, and for D1 via `DraftSaveApiFixture`. It does not say which fixture D2 and D4 use. Their checks run on the privileged pool, so RLS does not change the answer. Still, running them on `TwoUserRlsApiFixture` (the production shape) costs nothing and satisfies the AC literally.
- **D1 undo message.** `restoreBoundOutputs`' refusal surfaces as `edit N: pipeline write access revoked: <NoAccess|PipelineGone|Viewer>` (the `NonFatal` recover uses `ex.getMessage`). That tells a revoked user whether the pipeline still exists. The leak is minor and race-only, but task 3.3 should record the exact text. Consider mapping the refusal to the step-restore wording.
- **D1 caller argument.** No test fails if `restoreBoundOutputs` passes a different actor (for example the journal's pipeline owner) instead of `user`. The required parameter guards against omission, not against a wrong value. This is acceptable as a reviewed call site.
- **`RenderResult.Refused`.** Adding it to the sealed trait may trigger non-exhaustive-match warnings wherever `RenderResult` is matched. Check whether those warnings are fatal.
