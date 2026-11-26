## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed tree: c939f378146d5614be8e8c4cc12b9466dae08b15. The change dir is untracked. I took owner rulings Q1, Q2 and Q3 as given. I derived every claim below from the tree. I read round 3's report only to check whether its change request was addressed.

### What I verified (with evidence)

**HEL-1707 primitives.**
- `PipelineWriteAccess.currentAction/requireAction` uses explicit predicates. The pipeline owner, else the caller's own `resource_permissions` row; `mayWrite` = Owner or Editor.
- `AccessCheckerImpl.requireAccess` (:61-85) and `ResourcePermissionRepository.findGrant` (:80-90) apply the same rule: owner, else grantee row role. So admission and re-check agree for owners and current editors. That is the basis for "no non-race change" on D1, D2 and D4.
- `PipelineWriteRefusal.refused` maps Viewer to `Forbidden("Forbidden")` and everything else to the caller's not-found.

**D1 (Output create).**
- `insertInternal` is `withSystemContext(locks.lockPipelines(OutputCreate) andThen insertInternalAction).transactionally` (OutputRepository.scala:234-249). `locks` is injectable (:28).
- Production callers are OutputService.scala:159 and PatchSetUndoRestorers.scala:176, and `user.id` is the owner at the latter. The pre-check is at OutputService.scala:146-149.
- A no-grant caller gets `NotFound("Pipeline not found")` exactly: AccessCheckerImpl :77-78 has no id suffix, unlike HEL-1707's step routes. D1 rightly tells the executor to assert the live body.
- `RaceLocks` (PipelineGrantRecheckRaceSpec.scala:27-40) fires its racer inside the write's transaction, before the lock. Under READ COMMITTED the post-lock `requireAction` sees the commit. On c939f3781 the insert lands, so it is red for the stated reason.
- No other `lockPipelines` call precedes the insert in the create path.
- A refusal in `restoreBoundOutputs` is caught by `safeRestoreOne`'s `NonFatal` recover (PatchSetUndoService.scala:108-109) and becomes an edit-level `Left`, not a 500.

**D2 (backfill, X1).**
- `findByIdShared` (PipelineRepository.scala:83-107) uses an explicit owner-or-grant-row predicate, not RLS. A revoke before it yields `None` on any fixture, so it is correctly a GUARD.
- A downgrade before it still returns `Some` on main. That case is covered by variant (a), which fires after the read.
- `overwriteRows` accepts `guard` and runs it as the transaction's first action (NodeSnapshotRepository.scala:109-116, :210). `PipelineRunBackfill` calls it with no guard (:166), then `updateSchemaInternal` in a `flatMap`. A failed overwrite therefore skips the schema write.
- The early return on an existing snapshot (:77-78) and the `hasSucceededOnce` gate (:80-84) are both handled by D5's precondition and the spec scenario ("has a successful run").
- Mutation map:
  - Variant (a)'s spy count turns red under "remove the start check": the guard still refuses, but `overwriteRows` is called once.
  - Variant (b) turns red under `guard = None`.
  - Both are discriminating.
- `PipelineRepository` and `NodeSnapshotRepository` are non-final classes. `PipelineRunBackfill` is built from `PipelineRunService`'s injected repositories (PipelineRunService.scala:143).

**D3 (Output PATCH, X2).**
- `OutputService.update` (:225-270) runs `findById`, then `findConfigById`, then `updateOwned`. `updateOwned` (OutputRepository.scala:300-322) runs in `withUserContext(..)(combined.transactionally)`. An empty body goes to `findByOwned`.
- RLS policies:
  - `outputs_select` is `helio_can_access_pipeline(pipeline_id)` and `outputs_update` is creator-only (V94:238-248).
  - `pipelines_select` is `helio_can_access_pipeline(id)` (V39:79-80).
  - `resource_permissions_pipeline_select` lets the grantee see their own row (V39:104-120).
  - The only `DROP POLICY` touching these is in V39.
- So `requireAction` run in user context gives: a downgraded creator → Viewer (refused); an owner or editor → admitted; a revoked creator → `PipelineGone`. That last case is moot, because `outputs_select` already hides the row from the UPDATE's WHERE.
- Conclusion: the downgrade is red on main both inside and outside the race, and the revoke race is correctly a GUARD.
- `TwoUserRlsApiFixture` (base of `DraftSaveApiFixture`, :11) builds `helio_app_test NOSUPERUSER NOBYPASSRLS` (:131).
- Call sites:
  - `OutputService.update` callers are OutputRoutes.scala:114, PatchSetApplyForward.scala:105 and PatchSetApplyRollback.scala:186.
  - `updateOwned`'s only caller is OutputService.scala:253.
  - There is no `("output","update")` undo case (PatchSetUndoService.scala:112-135).

**D4 (insight refresh).**
- `refresh` (InsightRenderService.scala:106-114) calls `startRender` right after `InsightAccess.resolve`. That method calls `accessChecker.requireAccess` exactly once (InsightAccess.scala:15-21), so a delegating `AccessChecker` wrapper is a valid racer seam that needs no production change.
- `renderGuarded` (:185-217) writes `noSend` rows before `proceed` charges `quotaGate.checkAndIncrement(pipeline.ownerId, ..)` (:237). There is no access check after admission.
- `send` completes `done` with `Wrote(_, reachedModel = true)` after writing the row (:272-277). The observer can therefore await a definite red or green outcome.
- `inFlight` is released by `startRender`'s `andThen` when there was no hand-off (:180).
- `RenderResult` is sealed (:349-356) and is pattern-matched nowhere outside this file, so adding `Refused` causes no exhaustiveness fallout.
- The run (:97) and tick (:162) paths pass `automatic = true` and would get `requester = None`.

**NOBYPASSRLS claims.**
- D3 is the only check in user context. It is pinned to the NOBYPASSRLS fixture, and the design says a BYPASSRLS run never counts.
- D1, D2 and D4 run on the system context. In the fixture that is `helio_privileged`, which is BYPASSRLS (V34; cited in V62, V100 and V145), and that is also the production shape. Their answer is therefore RLS-independent. The claims hold.

**Round 3's change request is addressed.**
- Task 0.2 is a behaviour-neutral seam commit before the red run.
- D5 defines the 1.5 red base as c939f3781 plus that seam commit.
- 1.6 is reworded to "before any production check or refusal-mapping change".
- The `RaceLocks` extraction (0.1) is ordered before 1.2.

**Design and tasks agreement.**
- Ordering 0.x → 1.1 probe → 1.2-1.5 red → 1.6 red commit → 2.x → 3.x matches D5.
- Every production check has a named mutation that turns a planned test red: D1 check and Viewer mapping (1.2), D2 start check (1.3a) and in-tx guard (1.3b), D3 both branches and the 404 mapping (1.4), D4 start check (1.5).

**Non-race behaviour.** The only non-race change is X2: a downgraded or no-grant creator's PATCH, and the patch-set apply and rollback that go through it. That is inside Q2.

**Spec deltas.**
- The MODIFIED header matches openspec/specs/output-routes-api/spec.md:594 verbatim, and the delta correctly drops the "PATCH is unchanged" sentence.
- The ADDED requirement names do not collide with existing requirements in pipeline-editor-grant-recheck or insight-render-triggers.
- The existing "Manual refresh" requirement is not contradicted, because the `202` is unchanged.

### Verdict: CONFIRM

### Non-blocking notes
- tasks.md 1.6 says "only the 1.0 seam commit". The seam commit is task 0.2, and there is no task 1.0. Read it as 0.2 (and 0.1, which is test-only).
- tasks.md 1.1 says the probe runs "before any code change", but 0.1 and 0.2 are listed first. Neither touches the PATCH path, so the probe result is unaffected. Either run 1.1 first or read the phrase as "before any PATCH-path production change". 1.1 also says "either differs" over three expected outcomes; STOP if any of the three differs.
- D2 leaves open where the "context-bearing repository method" for the start check lives. Any placement works. Keep it separate from `findByIdShared`, so the variant (a) seam (a subclass overriding `findByIdShared`) stays independent of the check.
- D2 and D4 do not name a fixture. Their checks run on the BYPASSRLS privileged pool, so the answer does not depend on it. Running them on `TwoUserRlsApiFixture` anyway costs nothing and satisfies the ticket's NOBYPASSRLS AC literally for D2's new repository method.
- X2 may turn an existing test red if it seeds an Output whose creator has no grant on someone else's pipeline and PATCHes it on a superuser fixture. Such a fixture edit would be a defect symptom to explain, not something to silently "fix". 3.4's full-spec runs will surface it.
- Round 3's notes still apply: 3.3 should record the exact undo message for a refused `restoreBoundOutputs`, because `ex.getMessage` names the `WriteAccess` case. There is also no test pinning which actor `restoreBoundOutputs` passes.
