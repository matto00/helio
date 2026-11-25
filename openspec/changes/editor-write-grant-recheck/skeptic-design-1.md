## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: c939f378146d5614be8e8c4cc12b9466dae08b15 (the change dir is untracked). Owner rulings Q1/Q2/Q3 are taken as given.

### What I verified (with evidence)

- **HEL-1707 primitives exist as described.** `PipelineWriteAccess.currentAction/requireAction` (infrastructure/persistence/pipelines/PipelineWriteAccess.scala) uses explicit owner and grant predicates. `PipelineWriteRefusal.refused` (services/pipelines/PipelineWriteRefusal.scala) maps Viewer to `Forbidden("Forbidden")` and anything else to the caller's not-found. `ServiceError.Forbidden()` defaults to `"Forbidden"` (ServiceError.scala:24), so D1's 403 body matches the pre-check's.
- **D1 facts hold.** `OutputService.create` is at OutputService.scala:125-180: `requireAccess` answers Viewer with `Forbidden()` and none with `NotFound("Pipeline not found")`, then `insertInternal`. `insertInternal` is at OutputRepository.scala:234-249: `withSystemContext(lockPipelines(OutputCreate) andThen insertInternalAction).transactionally`. Its only production callers are OutputService.scala:159 and PatchSetUndoRestorers.scala:176 (`restoreBoundOutputs`, which has `user`). `OutputRepository` takes an injectable `locks`, so the RaceLocks approach works. The write is privileged, so both the revoke and the downgrade race are red on main for the stated reason (the Output gets inserted).
- **D2 facts hold.** `PipelineRunBackfill.evaluateNodeRowsForBackfill` (PipelineRunBackfill.scala:102) calls `findByIdShared` and then executes. `persistBackfilledRowsWithinLimit` (:166) calls `overwriteRows` with no guard, then `updateSchemaInternal` in a separate transaction. `overwriteRows` (NodeSnapshotRepository.scala:109) already accepts `guard`, and `overwriteRowsActionRendering` runs `guard andThen action` in one transaction (:210). `NodeSnapshotRepository` and `PipelineRepository` are both non-final classes.
- **D3 facts hold.** `OutputService.update` reads the Output with `findById` (user context), then `updateOwned`. `updateOwned` (OutputRepository.scala:300-325) runs in `withUserContext`, i.e. the app pool inside one transaction (DbContext.scala:50-51). Its empty-body branch goes to `findByOwned`. RLS policies:
  - `outputs_select = helio_can_access_pipeline` (V94:238).
  - `outputs_update = owner_id = current user` (V94:246).
  - `pipelines_select = helio_can_access_pipeline` (V39:79).
  - `resource_permissions_pipeline_select` lets the grantee read their own row (V39:104-121).
  - No RESTRICTIVE policy exists on these tables (grep of the migrations).
  So the NOBYPASSRLS claims hold: `currentAction` can run in user context, and a revoked caller gets `PipelineGone`. A creator downgraded to viewer passes both `outputs_select` and `outputs_update`, so X2's outside-the-race claim is plausible; probe 1.1 will confirm it.
- **D4 facts hold.** `refresh` (InsightRenderService.scala:106-115) admits through `InsightAccess.resolve`, then `startRender(.., automatic = false)`. `renderGuarded` (:185-217) reads the pipeline with `findByIdInternal` (privileged), writes `noSend` rows for config, model and no-model failures, and `proceed` (:220-246) charges `quotaGate.checkAndIncrement(pipeline.ownerId, ..)` before `send`. There is no access check after admission, so the race is red on main (a send and a row).
- **Role semantics match.** `AccessCheckerImpl.requireAccess` (api/http/AccessCheckerImpl.scala:51-76) resolves owner, then the grant role, which is the same rule as `currentAction`. Owners and current editors see no non-race change. The only non-race change is X2, plus the backfill a downgraded-creator PATCH used to trigger.
- **Spec delta headers.** The MODIFIED header `DELETE /api/outputs/:id requires current pipeline edit access` matches openspec/specs/output-routes-api/spec.md:594 exactly, and removes its "PATCH is unchanged" line.

### Verdict: REFUTE

Three of the design's stated facts and red-test claims are false on the tree. An executor following them would either find a "red" test green on main or chase a code path that does not exist. All three fixes are to the artifacts only. The approach (D1-D4) is otherwise sound.

### Change Requests

1. **The D3 revoke race cannot be red on main on the NOBYPASSRLS fixture.** Affected: design.md D3, D5 (D3 bullet), Context, and tasks.md 1.4.
   - `updateOwned`'s UPDATEs filter on `id`. In Postgres, an UPDATE that reads columns (WHERE) has the relation's SELECT policies applied as well as its UPDATE policies.
   - So once the grant is revoked, `outputs_select = helio_can_access_pipeline(pipeline_id)` hides the row. The UPDATE affects 0 rows, `updateOwned` returns `None` (OutputRepository.scala:318-322), and the route answers `404` with nothing written. That is already the post-fix answer.
   - Context's "a revoked creator gets 404 from findById except in the race window" is wrong under RLS: the race-window write is refused too. Only the **downgrade-to-viewer** race (and the non-race downgrade) is red on main.
   - Revise as follows:
     - Context: correct the sentence.
     - Task 1.4: make the revoke variant a GUARD, labelled as already refused by `outputs_select` and failable by a named mutation (for example, running the UPDATE on the privileged context). Keep "verify red on main (200 / changed)" for the downgrade cases only.
     - Do not let a superuser-fixture run stand in as the revoke red: dev/CI BYPASSRLS is not the production shape.
   - A one-line probe recorded with 1.1 settles this.
2. **D2 race variant (a) must say where the racer fires, or the revoke case is green on main.** Affected: design.md D5 (D2 bullet) and tasks.md 1.3.
   - `findByIdShared` (PipelineRepository.scala:83-100) looks up the caller's grant row. A revoke committed BEFORE it runs makes it return `None`, and `evaluateNodeRowsForBackfill` already writes nothing (PipelineRunBackfill.scala:103-104). So "racer in a `PipelineRepository` stub's `findByIdShared`" is green on main for the revoke case unless the racer fires AFTER the delegated read returns (between `findByIdShared` and the new start check).
   - Specify that ordering. Record "revoke before `findByIdShared`" as a GUARD (existing behaviour), not a red. The downgrade variant is red either way, because `findByIdShared` admits a viewer.
3. **"Undo of an Output update" does not exist; the real extra caller of `update` is missing.** Affected: proposal.md ("Patch-set rollback and undo of an Output update…"), design.md D3, specs/output-routes-api/spec.md (the ADDED requirement's SHALL "Patch-set rollback and undo of an Output update SHALL apply the same rule"), and tasks.md 3.3.
   - `PatchSetUndoService` dispatch (PatchSetUndoService.scala:122-135) has no `("output", "update")` case. It falls through to "no undo path for target.kind 'output' op 'update'".
   - The production callers of `OutputService.update` are:
     - OutputRoutes.scala:114
     - PatchSetApplyRollback.scala:186 (rollback, `RestorePriorStored`)
     - PatchSetApplyForward.scala:105 (patch-set forward apply of an Output update), which the artifacts never mention.
   - Remove the nonexistent undo path from the normative text and from 3.3. Name forward apply and rollback as the callers that inherit the rule, and have 3.3 record what each reports when refused.

### Non-blocking notes

- `InsightAccess` is `final class` (InsightAccess.scala:13). D5's "non-final `InsightAccess` subclass" needs a production change (dropping `final`) or a different seam. Name it in files-modified.md.
- `RaceLocks` is `private final` inside `PipelineGrantRecheckRaceSpec` (:27). Reusing it means extracting it to testsupport or copying it. Either is fine; say which.
- D4's "owner usage counter unchanged" only tells main and the fix apart if the pipeline owner is on a counted tier. Use a `beta` owner, or rely on the send and the row as the discriminating assertions.
- D3's race seam (an `updateOwned` override that commits the racer before `super`) does not distinguish an in-transaction check from a service-level check made before `updateOwned`. That is acceptable because PATCH takes no lock, but the mutation list (3.2) should not claim it pins the in-transaction placement.
- D2 needs `user` threaded into `persistBackfilledRows`/`...WithinLimit`, and a context-bearing repository method for the start-of-evaluation `currentAction`. `PipelineRunBackfill` holds no `DbContext`. These are mechanical.
- `PatchSetOutputResolvers.findOwnedOutput` (:25-34) pre-validates with the creator-only rule and will not mirror the new PATCH access rule. A downgraded creator's patch set passes pre-validation and is refused at apply. This matches HEL-1707's treatment of delete, so it is not a defect here. A one-line note in the design would pre-empt the question.
