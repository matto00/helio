## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD fe63a251886c3dfba142151afb8913fb025ef43b, with the planning artifacts uncommitted (`?? openspec/changes/step-reference-check-followups/`).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/step-reference-check-followups/HEL-1523`.
- **Artifacts are valid:** `openspec validate step-reference-check-followups --strict` -> "Change ... is valid"; `check-openspec-hygiene.mjs` -> "openspec/ is clean". The MODIFIED requirements keep every base scenario (base `openspec/specs/pipeline-lane-rejoin-input/spec.md` L35-84: 5 + 4 scenarios, all present in the delta, new ones added).
- **Item 1 premise (reorder cycle):** `PipelineStepRepository.reorderTrunkInternal` (L866-913) relinks trunk parents and does no lane check. `reorderSteps` (PipelineStepWrites.scala L163-180) maps every `Left` to 422 and has no `.recover`. The design's example works: tail T of A with a lane ref to C, reordered to C,A,B, makes C an ancestor of T. D1's mechanism (fail the DBIO inside `.transactionally`, then the service maps a dedicated exception to 400) can roll back. Newly-introduced-only, keyed on (ref, target) pairs, is sound and does not strand legacy rows.
- **D2 (400):** this is defensible. `validateLaneReference` (PipelineService.scala L350-370) already returns `BadRequest` for every lane-cycle arm, and the 422s are permutation-shape errors only. The frontend reorder path reverts and toasts on failure (`usePipelineStepMutations.ts` L107-114 doc and handler), so no UI change is needed. Only `PUT /steps/order` exists (PipelineStepRoutes.scala L37). The proposal's "PUT/POST" wording is a nit.
- **Item 3 premise and D4:** create passes `pipelineAccessF` as the third stage, after `laneCheckF` (StepReferenceChecks.scala L32-48; PipelineStepCreate.scala L102). `laneScopeF` reads through `*Internal` with no ACL (L65-66). Today a stranger therefore gets three different answers: 422 for a missing id, 404 for an existing non-ancestor, 400 for the trunk-last step or its ancestors. A viewer gets 422 vs 403. Moving access first closes this. Nothing before the chain in `addStepReporting` (kind check, `rawConfigProblem`, decode; L34-50) reads the pipeline. Viewer: `requireEditorAccess` returns 403 before `laneScopeF` is evaluated. Update and duplicate already run `findByIdShared` plus an editor check before the chain (PipelineStepWrites.scala L40-45, L262). Their `Future.successful(Right(pipeline))` access stage is unchanged.
- **Patch-set audit (D4):** I checked it myself. Create calls `authorizeEditorOrOwnerOnPipeline` first (PatchSetPipelineStepResolvers.scala L212), before decoding. Update calls `requireVisibleStep` (L87; PatchSetApplyResolvers.scala L223-232, which masks invisibility as "pipeline step not found") before any config check. The lane check itself runs only at apply time, through `PipelineService.addStep`/`updateStep`. No probe there.
- **D3:** `StepPlacement.resolveCreateAnchor` (StepPlacement.scala L19-58) already yields today's prospective parent for the parentStepId, rootId and bare-default arms. Only bare `position` (`steps(index-1)`) changes. Keeping today's computation when placement fails (`Left`) preserves existing error precedence. With access now first this has no security effect, so it is acceptable.
- **D5 premise:** `secondaryDataSourceId(` is called at exactly 3 sites besides the shared chain: PipelineCreateTransaction.scala:125, PatchSetPipelineStepResolvers.scala:62 and :257. Their messages match the design.
- **Task 2.1 fixture (see CR2):** I traced it through `validateLaneReference`'s order (ancestor checked before descendant) and `executionOrder` (PipelineStepRepository.scala L1290-1305: a node, then its tails, then its trunk child).
- **Task 4.1 grep (see CR1):** ran it today. It returns 11 hits.

### Verdict: REFUTE

Both requests are cheap artifact edits. The design's substance (D1-D6) is sound. The problem is two acceptance signals that would either be impossible to meet or would prove nothing.

### Change Requests

1. **Task 4.1's acceptance grep cannot pass without scope drift.** I ran `grep -rn "findByIdOwned(DataSourceId" backend/src/main/scala/com/helio/services/{pipelines,patchsets}` and it returns 11 hits. Eight of them are root-source or proposal checks that this ticket does not touch: PipelineProposalService.scala:111,358; PipelineProposalAnalyze.scala:224; PipelineCreateWrites.scala:103; PatchSetPreviewPipelineProjection.scala:73; PatchSetPipelineResolvers.scala:124; PatchSetUndoConflictCheck.scala:145. Following the task literally means either refactoring all of them or failing the check. Replace the signal with one scoped to the secondary-source check. For example, `grep -rn "secondaryDataSourceId(" backend/src/main/scala` returns only the codec definition and `StepReferenceChecks`. Today it shows 4 call sites.

2. **Task 2.1's test does not flip outcome, so it cannot prove AC2.** On a linear trunk A->B->C, `position=1` anchors at A and re-parents B under the new step, so B and C become would-be descendants.
   - Lane ref to B returns `400` on both old and new code. Old code says "ancestor" (B is an ancestor of trunk-last C). New code says "descendant".
   - "Lane ref to A is rejected 400" passes on old code too.

   The only red would be a message-string change, which is weak. On a single chain, every bare-position lane ref is rejected either way.

   Fix: use a fixture whose outcome actually changes. Trunk A->B->C with a tail T of A has `executionOrder` = [A, T, B, C]. A create with `position=2` anchors at T and re-parents nothing (T has no children).
   - Lane ref to B: old code gives 400 "ancestor" (B is an ancestor of C). New code accepts it with 201, because B is neither an ancestor of T nor re-parented.
   - Keep a rejection case: lane ref to T or A returns 400 ancestor.

   Also tighten the spec scenario "A bare-position create checks ancestors of its real anchor". Its first THEN, "does not reject it as an ancestor reference", reads as acceptance. State the precondition (the named step is also not re-parented under the new step) and the outcome ("the step is created").

### Non-blocking notes

- **D1 overstates race safety.** The reorder transaction runs at READ COMMITTED with no row locks. A concurrent `updateStep` that sets a lane ref and a reorder can each pass their own check and commit a cycle together. Create/update already have this race, and the run-time rejection is the backstop. Reword the rationale ("checked against the rows this transaction wrote"), or lock the pipeline's step rows if you actually want race safety. Don't claim it.
- **D1 helper placement.** `ancestorChainOf` and `descendantStepIds` are `private[pipelines]` in `com.helio.services.pipelines`. The repository is in `com.helio.infrastructure.persistence.pipelines`, so it cannot call them as-is. The "ONE implementation" will need to move to a shared location (for example `com.helio.domain.pipelines`, beside `PipelineCycleValidator`) or have its visibility widened. Settle this before HEL-1521 extends it.
- **D1 rollback.** The violation must be raised with `DBIO.failed` inside `.transactionally`, not returned as a `Left` after the updates have run. A `Left` would commit the relink. Task 3.2's "placement unchanged" assertion catches this, but call it out to the executor. `reorderSteps` also needs a `.recover` for the dedicated exception, or it surfaces as a 500.
- The proposal says "`PUT/POST` trunk reorder". Only `PUT` exists.
