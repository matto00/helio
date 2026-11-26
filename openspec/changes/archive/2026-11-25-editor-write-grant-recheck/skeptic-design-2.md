## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: c939f378146d5614be8e8c4cc12b9466dae08b15 (the change dir is untracked). Owner rulings Q1/Q2/Q3 are taken as given. Round 1's three change requests are addressed in the current artifacts: the D3 revoke race is a GUARD, D2 variant (a) fires after `findByIdShared`, and the nonexistent Output-update undo is gone. I re-derived the facts below from the tree; I did not rely on round 1.

### What I verified (with evidence)

- **HEL-1707 primitives.**
  - `PipelineWriteAccess.currentAction/requireAction` (infrastructure/persistence/pipelines/PipelineWriteAccess.scala) uses explicit owner and grant predicates. `mayWrite` is Owner or Editor.
  - `PipelineWriteRefusal.refused/toError` (services/pipelines/PipelineWriteRefusal.scala) maps Viewer to `Forbidden("Forbidden")` and anything else to the caller's not-found.
  - `ServiceError.Forbidden(message = "Forbidden")` (ServiceError.scala:24), so D1's 403 body equals the pre-check's `Forbidden()`.
- **D1 facts.**
  - `OutputService.create` is at OutputService.scala:125-180. The pre-check is `requireAccess(.., "Pipeline not found")`: Viewer gets `Forbidden()`, and a stranger gets `NotFound("Pipeline not found")` (AccessCheckerImpl.scala `requireAccess`, the `None` branch).
  - `insertInternal` is at OutputRepository.scala:234-249: `withSystemContext(lockPipelines(OutputCreate) andThen insertInternalAction).transactionally`.
  - Production callers are OutputService.scala:159 and PatchSetUndoRestorers.scala:176 (which has `user`).
  - `OutputRepository` takes injectable `locks`. `RaceLocks` (PipelineGrantRecheckRaceSpec.scala:27, `private final`) fires its racer inside the write's transaction before the lock. Under READ COMMITTED both races are red on main for the stated reason: the privileged insert lands.
  - OutputService.scala has exactly one `ServiceError.Forbidden(` producer today, and ExistenceNotLeakedRoutesSpec pins `"OutputService.scala" -> 1`. D1 routes the refusal through PipelineWriteRefusal, so that count does not change.
- **D2 facts.**
  - `evaluateNodeRowsForBackfill` (PipelineRunBackfill.scala:102) reads `findByIdShared`, then executes. `persistBackfilledRowsWithinLimit` (:162-179) calls `overwriteRows` with no guard, then runs `updateSchemaInternal` in separate privileged transactions.
  - `overwriteRows` (NodeSnapshotRepository.scala:109-116) accepts `guard` and runs `guard andThen action` in one transaction (:210).
  - `PipelineRepository` and `NodeSnapshotRepository` are non-final, so the subclass seams work.
  - The backfill is a no-op unless the node has no snapshot and the pipeline has succeeded once (:76-86). The design's "pipeline that has a successful run" precondition covers this.
  - The only production entry point is OutputService.scala:78 via PipelineRunService.scala:278.
- **D3 facts (RLS).**
  - `outputs_select` is `helio_can_access_pipeline(pipeline_id)` (V94:238). `outputs_update` is owner-only (V94:246). `pipelines_select` is `helio_can_access_pipeline(id)` (V39:79). `resource_permissions_pipeline_select` lets the grantee read their own row (V39:104-121).
  - Under user context, `currentAction` can therefore read both tables: a viewer resolves to `Viewer`, and a revoked caller resolves to `PipelineGone`. Both are refused.
  - A creator downgraded to viewer passes both `outputs_select` and `outputs_update`, so the non-race downgrade red on main is sound. The revoke-race GUARD is consistent with Postgres applying SELECT policies to an UPDATE that has a WHERE clause.
  - `updateOwned` is OutputRepository.scala:300-322, with `None` at :321. It runs in `withUserContext` (DbContext.scala:50-51: app pool, `setUserVar andThen action`, transactional).
  - The fixture is genuinely NOBYPASSRLS: `TwoUserRlsApiFixture` creates `helio_app_test NOSUPERUSER NOBYPASSRLS` (:131).
  - `OutputService.update` callers are OutputRoutes, PatchSetApplyForward.scala:105 and PatchSetApplyRollback.scala:186. PatchSetUndoService has only `("output","create")` (:133).
- **D4 facts.**
  - `refresh` (InsightRenderService.scala:106-115) admits via `InsightAccess.resolve`, then calls `startRender(.., automatic = false)`.
  - `renderGuarded` (:185-217) writes `noSend` rows before any quota charge. `proceed` charges `quotaGate.checkAndIncrement(pipeline.ownerId, ..)` before `send`.
  - There is no access check after admission, so the race is red on main.
  - `InsightAccess` is `final class` (InsightAccess.scala:13). D5 names dropping `final` as a listed production change.
  - The service holds `ctx: DbContext` for the system-context check.
  - The only `automatic = false` caller is `refresh` (:111). Run (:97) and tick (:162) renders are automatic.
- **Non-race behaviour.** Owners and current editors are unchanged in D1, D2 and D4, because `currentAction` uses the same owner/role rule as `AccessCheckerImpl.requireAccess`. The only non-race change is X2, plus the backfill that a downgraded creator's PATCH used to trigger.

### Verdict: REFUTE

The approach is sound and the factual claims hold on the tree. Two test-design defects remain. As written, each one leaves a production behaviour that no test can fail, and that contradicts task 3.2 ("remove each re-check turns its red test red again").

### Change Requests

1. **D2's start-of-evaluation check cannot be failed by any planned test.** Affected: design.md D2/D5, tasks.md 1.3 and 3.2.
   - Variant (a) fires the racer after `findByIdShared` and asserts only "no node_snapshots rows and empty Output schema".
   - With the start check mutated away, evaluation proceeds, and the new in-transaction `overwriteRows` guard still refuses. Variant (a) stays green.
   - Removing the guard instead leaves (a) green because the start check catches it. Only (b) pins the guard.
   - So "remove the start check" turns no test red, and D2's stated reason for the check ("a refused backfill does not execute the owner's sources at all", Planner Notes) is never pinned. The executor will hit this contradiction at task 3.2.
   - Revise as follows:
     - Variant (a) must also assert a signal that only the start check produces. For example, a spy `NodeSnapshotRepository` records zero `overwriteRows` invocations, or a counting `PipelineExecutionBackend`/data-source read records zero executes.
     - Task 3.2 must name the mutation "remove the start check -> (a) red" alongside "remove the guard -> (b) red".
     - The alternative is to drop the start check and keep only the in-transaction guard.
2. **D4's negative assertions have no deterministic completion point.** Affected: design.md D5 (D4 bullet), tasks.md 1.5.
   - `refresh` returns `202` before the render runs. `startRender`'s `done` future is not exposed, and listeners fire only on a written render (InsightRenderService.scala:333).
   - The existing spec polls for positive outcomes (`until("ok row")`, InsightRenderServiceSpec.scala:177/330). A refused render produces nothing to poll for.
   - So "zero sends, no `output_insights` row, usage unchanged" after the fix can pass vacuously if asserted before the render has run. The same assertions on main can race the render, which makes the red flaky. That violates D5's "deterministic, no sleeps".
   - Specify a completion seam the test awaits in both the red and green runs. For example, a constructor-injected render observer defaulting to a no-op (like `OutputService.backfillObserver`) that receives the `startRender` result future. Then assert `RenderResult.Refused` after the fix and a `Wrote(.., reachedModel = true)` on main, in addition to sends, rows and counter.
   - Name the seam in files-modified.md as a production change.

### Non-blocking notes

- **Patch-set rollback and D3.** If a forward-applied Output update succeeds and the editor is downgraded before a later edit fails, the `RestorePriorStored` rollback is now refused (404) and the Output keeps the forward value. Before this change, the downgrade case rolled back. This is within the race and HEL-1707 accepted the same for steps and delete. Task 3.3 should record what the rollback reports, as it already plans for "not a 500".
- **`restoreBoundOutputs` and D1.** A refusal in `restoreBoundOutputs` leaves the step restored and its Outputs not restored. That is a partial undo. D1 already says to stop if the undo reports a 500; also record whether the step restore was rolled back.
- **RaceLocks extraction.** Extracting `RaceLocks` to testsupport touches `PipelineGrantRecheckRaceSpec`. Task 2.0's "still green" run covers it.
- **D4 when the pipeline is gone.** With a `Some` requester and the pipeline deleted, the render now returns `Refused` rather than `Gone`. Neither writes a row and the difference is not observable. That is fine.
