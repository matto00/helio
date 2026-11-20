## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: bec60a6084dd5f7232ac515baa47d86ea2669d14 (red 0167f9d0e + implementation bec60a608), base eb0521f00 (resolved live).

### Phase 1: Spec Review — FAIL

The behaviour is correct, and both ACs are met. A create-arm undo that would delete a panel the set did not create is refused whole (409, nothing restored), for all four arms. The two-user case is covered on `helio_app_test` through the real `PanelService.duplicate` path. The constraints C1–C4 are honoured in the code.

Issues:
- **Planning artifacts do not match what was built (deviation 1).** The D2 point 2b panel-update excusal was dropped in code, but three documents still promise it:
  - `design.md` D2 point 2 still lists "the target of every `panel` `update` edit whose journaled priorState binding is not one of the doomed Outputs" as excused.
  - `proposal.md` What Changes, bullet 3, still says "...and panels whose binding the same patch set changed and whose undo restores a binding outside the deleted resources, do not block".
  - `specs/patch-set-undo/spec.md` still says "A panel whose binding this patch set changed does not block when its undo restores a binding outside the resources being deleted."
  The spec delta is what gets archived into the canonical spec, so it must describe the shipped rule.
- **Tasks 2.2 and 3.2 are ticked, but part of their "Verify" clause has no test.**
  - 2.2 requires a test that the Phase-2 failure reason is the fixed phrase plus a count. No test asserts `PatchSetUndoBoundPanels.boundDuringUndo`'s text, or that the ERROR-logged reason carries no title or id. The window test asserts only `status == "failed"`.
  - 3.2 says "Verify by test". The blocking branch of `ifStillUnbound` (pipelineStep, pipeline and dashboard arms) is never reached by any test. Mutation (a) removed the Phase-1 wiring only, and no mutation removes `ifStillUnbound`. The pass-through branch does run, in the PatchSetUndoLaneSpec second undo and the clean-undo test.
  - `files-modified.md` does not disclose either gap.

Deviation judgments requested by the orchestrator:
1. **Dropping the D2 panel-update excusal: the reasoning holds for all four arms. It causes no false refusal and misses no case.** I checked each way a patch set could put an existing panel onto a resource the same set created:
   - **Output.** `$ref:` is honoured only on a panel create (`PatchSetPanelResolvers.scala:117-121`). A panel update goes through `panelDryRun.checkUpdate`, which resolves `outputId` against existing rows, so `$ref:x` is refused.
   - **Dashboard.** A panel cannot change dashboards. `CreateDashboardRequest` carries no inline panels, and `ifExists` is refused (`PatchSetApplyResolvers.scala:178`).
   - **Pipeline.** Its inline outputs are not `$ref`-addressable (`PatchSetRefs.register` records only an `output` create's kind). The new pipeline's id does not exist at resolve time, so an output create or panel edit in the same set cannot target it.
   - **pipelineStep.** Step ids are server-generated UUIDs that do not exist at resolve time. A `pipelineStep` update cannot reparent onto the new step, and an output create (which needs a saved `nodeStepId`) cannot attach to it.
   - So every panel the doomed set can contain was either created by the set as a panel create (excused) or added outside the set (correctly blocking).
   - One case is a refusal, but a correct one. After the apply, a user adds a child under the set-created step with a lower position than the step's existing first child, so the pre-existing child is no longer the promoted head. `removalOf` then removes the pre-existing child's subtree, and its panels would really be deleted, so blocking is right.
2. **Changing the PatchSetUndoLaneSpec expectation from cascade to refusal is justified.** The old test asserted the exact behaviour the ticket calls a bug: a panel bound after the apply was silently cascaded away (`removedPlacementCount == 1`, panel gone). The new form asserts the refusal, that the step, Output and panel survive, and the clean undo once the user removes the panel. The test title still says "cascading its Output/placement, reporting the placement count", which is now false. See CR 4.
3. **The 3.1 no-deadlock claim rests on lock-order reasoning, which I accept.** The new `SELECT ... FOR UPDATE` on the Output row is taken after `locks.lockPipelines`, the lock a draft save takes first (HEL-1629). A concurrent draft save is therefore serialized on the pipeline row before either side can hold the Output row. The pre-existing `DELETE FROM outputs` already took the same row lock at the end of the same transaction, so this adds no lock edge, it only moves the wait earlier. A panel-create race (key-share on the Output) is exercised by the window test and ends as `failed` with no 40P01. If an unexpected deadlock did occur, Postgres would abort the undo's transaction: a failed edit, not a silent delete, which is the safe direction. A concurrent draft-save test would still be stronger evidence. It is not required for PASS.

### Phase 2: Code Review — FAIL

Gates, run fresh by me (backend-only diff, so no frontend gates apply; `ANTHROPIC_API_KEY` empty; `sbt -J-Xmx3g`, `nice -n 19`):
- `testOnly PatchSetUndoBoundOutputPanelsSpec PatchSetUndoLaneSpec`: 12/12 passed (all 7 new cases and all 5 lane cases).
- `testOnly com.helio.services.patchsets.PatchSetUndo* com.helio.api.routes.patchsets.* PatchSetOutputCreateSpec PatchSetRollbackLaneStepSpec`: 245/245 passed (31 suites).
- `testOnly PatchSetApply* PatchSetAppliedProposalsRlsSpec PatchSetDashboardGrantSpec PatchSetInlineRootRollbackSpec PatchSetInsightOutputSpec PatchSetPipelineStepGrantSpec Hel914Ac1EndToEndSpec OutputRepositoryRequiredSpec DraftSaveUndoSpec DraftSaveRootsUndoSpec`: 113/113 passed (12 suites).
- `npm run check:scala-quality`, `check:openspec`, `check:spec-structure`, `check:repo-integrity` and `format:check` are clean. scala-quality reports only soft-budget warnings.
- I did not run the full `sbt testFull`. It does not fit the 600 s tool timeout, so I sharded it as the orchestrator authorized: every undo and apply spec, the patch-set route specs, and every out-of-package spec that references undo. The untouched preview and refinement specs were not run.

Specific verifications requested:
- **App role.** `PatchSetUndoBoundOutputPanelsSpec` builds `DbContext(appDb, privDb)`. `appDb` is a Hikari pool with `SET ROLE helio_app_test`, a role created `NOSUPERUSER` and therefore NOBYPASSRLS, and not the owner of the tables, so RLS applies. Apply, undo, `PanelService.create`/`duplicate`, `OutputService`, `PipelineService` and `DashboardService` all run on that context. The cross-user copy comes from `appPanels.duplicate(aPanel, otherUser)`, and the test checks the copy's `ownerId == otherUser.id` and its `output_id`.
- **Disclosure.**
  - `describe` names a panel only when both `panelRepo.findById(_, Some(user))` and `dashboardRepo.findById(_, Some(user))` succeed. Every other panel is only counted.
  - The pipeline-arm test asserts that B's private panel title, B's private dashboard name and B's panel id are all absent from the message. Mutation (c, strengthened) shows that assertion can fail.
  - The Phase-2 reason is `boundDuringUndo(n)`, a count only, and is the only new text logged at ERROR (`PatchSetUndoService.scala:104`).
  - The 409 body is not logged: `ServiceResponse.completeError` has no logging.
  - No new log statement anywhere carries a title, name or id.
- **helio-mcp and the web toast** stay accurate, with no code change needed.
  - `helio-mcp/src/tools/refinement.ts:129-131`: "if any touched resource changed since the apply ... the whole undo is refused and nothing is touched". A resource that gained panels has changed.
  - `PatchSetReviewPage.tsx:131-135` shows the server's string as the error toast.

Code issues:
- **Dead code (unused imports).** `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoBoundPanels.scala:5` `import spray.json.JsString` and `:8` `import scala.util.Try` are never used.
- **Dead code (vestige of the dropped excusal).** `PatchSetUndoBoundPanels.doomed` returns `(Set[String], Vector[String])`. The first element, the doomed Output ids, was only needed by the D2 2b excusal. Its only caller throws it away (`:33`, `case (_, doomedPanels)`), and every branch builds it for nothing (`:39-59`).
- **Stale test title.** `PatchSetUndoLaneSpec`: "should restore a pipelineStep create edit ('add lane') by removing the step AND cascading its Output/placement, reporting the placement count". The test now asserts a refusal, and then `removedPlacementCount == 0` once the panel has been removed by hand.
- Everything else checks out:
  - Type safety, error handling and modularity are sound.
  - The shared check sits in one place and is used by both phases (DRY).
  - The internal reads are justified by the need to see other users' panels.
  - The `deleteIfUnboundInternal` recount runs after the `FOR UPDATE` under READ COMMITTED, so it sees any bind that has committed.

### Phase 3: UI Review — N/A
The diff does not touch `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. The only spec file changed is the change-local delta.

### Overall: FAIL

### Change Requests
1. **Remove the dead code in `PatchSetUndoBoundPanels.scala`.**
   - Delete the unused imports at `:5` (`spray.json.JsString`) and `:8` (`scala.util.Try`).
   - Make `doomed` return only the panel ids (`Future[Vector[String]]`). The doomed-Output-id element of the tuple is never read since the D2 2b excusal was dropped. Simplify `byOutputs` and the `case (_, doomedPanels)` at `:33` to match.
2. **Make the planning artifacts describe the shipped rule (only panels the set itself created are excused).**
   - `specs/patch-set-undo/spec.md` (Requirement paragraph 1): remove or rewrite "A panel whose binding this patch set changed does not block when its undo restores a binding outside the resources being deleted."
   - `proposal.md` What Changes, bullet 3: drop the "panels whose binding the same patch set changed..." clause.
   - `design.md` D2 point 2: mark the panel-update excusal as not implemented, and state why. A panel update cannot name `$ref`, and no set-created resource id exists at resolve time.
3. **Back the ticked "Verify" clauses of tasks 2.2 and 3.2 with tests, or untick them and disclose.**
   - (a) Assert the Phase-2 reason text. Either a direct assertion on `PatchSetUndoBoundPanels.boundDuringUndo(n)`, or, better, capture the `restoreAll` ERROR log in the window test and assert it contains the fixed phrase and a count, and not `Raced` or the panel id.
   - (b) Cover the `ifStillUnbound` blocking branch for at least one of the pipelineStep, pipeline or dashboard arms. A test that drives that branch with a bound panel and shows the edit `failed` with the panel intact would do, and a mutation that removes `ifStillUnbound` should then turn it red. If no seam can reach it without production test hooks, say so explicitly in `files-modified.md` and in task 3.2, rather than leaving the task ticked as verified.
4. **Rename the stale PatchSetUndoLaneSpec test title** to describe what it now asserts, for example "should refuse a pipelineStep create undo while a later-bound placement exists, then remove the step and its Output once the placement is gone".

### Non-blocking Suggestions
- `PatchSetUndoService.scala` grew from 384 to 402 lines. CONTRIBUTING.md:24 says that once a file passes ~400 lines, the PR description should propose a split.
- `removedPlacementCount` on the pipelineStep create undo outcome is now always 0, except in the residual race. A set cannot create an Output on its own new step, and later-bound placements now refuse the undo. Consider a follow-up to retire it, or document that it is always 0.
- A concurrent draft-save test for the Output arm's new row lock would turn the 3.1 lock-order argument into measured evidence.
- The PR body should state the accepted residual for the three service-owned deletes (V130 RESIDUAL), and the non-goal that a pipeline-create undo still deletes Outputs other users added (their panels are protected).
