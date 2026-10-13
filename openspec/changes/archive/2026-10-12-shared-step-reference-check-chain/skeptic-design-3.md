## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `849dd96c936182d4a8c8597c3cbdc92ae39fcb82`. The change dir is untracked, so I read the artifacts from the working tree. Source paths are relative to `backend/src/main/scala/com/helio/` and test paths to `backend/src/test/scala/com/helio/`, unless written in full.

### What I verified (with evidence)

- **Cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/shared-step-reference-checks/HEL-1515`.
- **Round-2 CR1 (d2 replaced by the create call-site mutation d2'): addressed.** D2 now says the upsert-after-lookup order is enforced by the `A => UserId` data dependency, and it defines d2' as dropping the editor check from create's `beforeUpsertF`. I checked that d2' is observable:
  - `PipelineService.requireEditorAccess` (L252-261) returns `403 Forbidden` for a viewer.
  - `PipelineServiceSupport.upsertOwnershipCheckF` (L189-199) maps `UpsertTargetCheck.NotFound` to 404 and `NotWritable` to 422.
  - So a viewer with an upsert target the pipeline owner does not own gets 403 today. Under d2' the same request gets 404 or 422. The guard test turns red on the status alone.
  - Task 1.5 lists d2'.
- **Round-2 CR2 (placement guard): addressed.** D4 has a "Create placement guard" bullet. It names out-of-range `position` with a range check before indexing, both ids, neither id on a multi-root pipeline, an unknown root and an unknown parent, plus `rootId` returning `Left`. It also requires an out-of-range-plus-lane test. I matched each item against `services/pipelines/PipelineStepCreate.scala`:
  - both ids: L179-185
  - unknown root: L201-202
  - unknown parent: L226-229
  - multi-root: L260-263
  - range guard: L300
  - `resolveRootTrunkAnchor` `Left`: `PipelineService.scala` ~L405
  
  I also checked the re-parent arms against `PipelineStepRepository.spliceInsertReportingInternal` (L720-724) and `siblingsQuery` (L1049-1053). k=0 re-parents every root-level step, an explicit root re-parents that root's parentless steps, and an anchor re-parents all of the anchor's children. These match D4.
- **Round-2 CR3 (proposal alignment): addressed.** proposal.md now states the C1 assumed call (built, OWNER REVIEW, parked) and the full scope (parent or lane dependents; update and any re-parenting create, including a plain append onto a trunk step that owns a tail; duplicate unchanged). This matches design D4 and the spec delta.
- **Fresh pass over the artifacts.** There are no placeholders, TODOs or TBDs. AC1 maps to D1/D2 and tasks 1.3-1.5. AC2 maps to D3 and 3.1. AC3 maps to D4, 1.2, 1.6 and 3.2. AC4 maps to D5, 2.1 and 3.3. The spec delta headers match the base spec. Every original scenario is retained, and the new create scenario is consistent with D4.
- **Existing duplicate lane tests assert status only:** `api/routes/pipelines/DuplicateStepReferenceChecksSpec.scala` L141 and L144 (422), and L158 and L162 (400). So the AC2 premise holds.
- **New finding: who calls create and update.** `services/patchsets/PatchSetApplyForward.scala` L93/L99, `PatchSetApplyRollback.scala` L161/L248 and `PatchSetUndoService.scala` L247/L281 all call `pipelineService.addStep` or `updateStep`. So patch-set apply, rollback and undo inherit the D4 rule. The design only scopes out `PatchSetPipelineStepResolvers` and never mentions these callers.
- **New finding: an existing spec breaks under D4's create rule (code trace, not run).** `services/patchsets/PatchSetUndoLaneSpec.scala` L125-152, "refuse to undo a pipelineStep create when a later step's lane secondaryInput references it":
  - A patch-set create puts limit `L` under `anchor` (L132), as a splice.
  - The test then calls `seedPipelineStep(..., "union", lane -> L, parentStepId = Some(anchor.id))` (L141-145).
  - `seedPipelineStep` (`PatchSetUndoServiceFixture.scala` L173-190) calls `pipelineService.addStep` without `attachAsTail`. That takes the `parentStepId` splice arm, so `siblingsQuery(pipelineId, Some(anchor))` re-parents `L` under the new union.
  - Under D4 the seeds are anchor's children = {L}. The lane target L is therefore a dependent, and the call returns 400. The fixture then hits `case Left(e) => fail("seedPipelineStep failed")` at L189, so the test goes red.
  - The test's comment says the two steps are "SIBLINGS". The code actually puts L under the union. Today it builds an unrunnable cycle that the test never runs.
  - D2/C2 say every existing spec passes unmodified, and the design has no rule for an existing spec that the C1 behaviour change, rather than the refactor, turns red. The executor would have to edit a fixture under C2 or stall.
- **New finding: undo of a deleted rejoin step.** Undo of a pipelineStep delete recreates the step through `addStep` with `parentStepId = prior parent` and no `attachAsTail` (`PatchSetUndoInverse.scala` L136-151; `PatchSetApplyRollback.scala` L364-370). Take P with children D (trunk) and T (tail), where D lanes T. That is a legitimate graph, because T is not a dependent of D. Delete D, then undo it:
  - The recreate splices under P and re-parents T under the new D.
  - Today that silently produces a cyclic, unrunnable pipeline.
  - Under D4 the undo fails with a 400 "depends on this step" error.
  
  Both outcomes are defects. The new one is a user-visible change in the patch-set undo/rollback outcome that neither the design nor the OWNER REVIEW notes mention. This is from code reading, not a run.

### Verdict: REFUTE

### Change Requests

1. **Handle existing specs that D4 (not the refactor) turns red. `PatchSetUndoLaneSpec` L141-145 is a concrete one.** In design.md D2/D4 and tasks.md (1.6, 3.4):
   - (a) After 1.6, the executor re-runs the 1.1 list plus every spec that creates a lane-referencing step through `addStep` (grep for `"kind" -> JsString("lane")` / `"kind":"lane"` under `backend/src/test`). It records any spec that goes red only because of the new branch.
   - (b) State the rule for such a spec. Recommended: a C2 carve-out for fixture-only corrections where the fixture's own stated intent is already contradicted by the code. Here that means adding `attachAsTail = Some(true)` to the sibling seed, which makes the "SIBLINGS" comment true. Changing an assertion stays forbidden. Every such fixture edit is listed in the PR's OWNER REVIEW section as evidence that the C1 rule rejects a placement in-repo code already used. If the owner would rather not carve out C2, the alternative is to escalate on the first hit.
   - (c) Name `PatchSetUndoLaneSpec` explicitly as a known hit, so this is a planned edit rather than a surprise.
2. **Acknowledge that patch-set apply, rollback and undo inherit the D4 rule.** `PatchSetApplyForward` L93/L99, `PatchSetApplyRollback` L161/L248 and `PatchSetUndoService` L247/L281 all call `addStep` or `updateStep`. In design.md (Non-Goals / Planner Notes) and the PR OWNER REVIEW list:
   - Undo or rollback of a deleted step that lanes into a sibling under the same parent now fails with 400 instead of silently restoring a cyclic graph. The recreate splices with no `attachAsTail` and re-parents the sibling under it.
   - Record whether this gets a probe in 1.2. Recommended: add it as a 1.2 red-repro arm (create, delete via patch set, undo; record today's outcome).
   - Report the undo-fidelity defect (the recreate re-parents siblings it never owned) as a follow-up. It is not fixed here.

### Non-blocking notes

- **`attachAsTail` arm wording.** D4 lists "`attachAsTail` -> none" next to the `parentStepId` arm. But `persistNewStep` only honours `attachAsTail` in the `parentStepId` arm (L235). With `rootId`, or with no anchor, it is ignored and the insert still splices. Say "`parentStepId` + `attachAsTail` -> none", so a global `attachAsTail` short-circuit doesn't miss real re-parents. D4's "factor the anchor derivation so the check and the insert cannot disagree" mostly covers this.
- **"No extra DB round-trip" vs the multi-root guard.** Detecting "neither id on a multi-root pipeline" needs `listRootDataSourceIdsInternal`, and the plain `(None, None)` lane path does not fetch it today. One extra roots read is fine. The executor should not bend the guard to keep the no-round-trip phrase.
- **Race window.** The dependents set, like today's ancestor check, is computed from a step list read before the insert transaction. That is a pre-existing time-of-check/time-of-use window, and the engine's run-time check stays the backstop. This is acceptable.
- **Carried over and already noted:** the existence oracle before the pipeline-access check, and the `rejectIfReparents` precedence. Both are in the Planner Notes.
