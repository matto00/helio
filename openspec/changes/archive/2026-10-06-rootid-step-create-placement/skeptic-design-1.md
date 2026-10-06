## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `9c41719c376b858ab9269fa6075f8b3b74acabd1` (main; the change dir is untracked, there are no commits beyond main). This was a read-only review. I ran no sbt, Jest or Playwright, and wrote nothing to the dev DB.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/rootid-step-create-placement/HEL-1345`.
- **The defect, by code reading:** confirmed. `PipelineService.scala:1974-1992`, the `(None, Some(rootIdRaw))` arm, never reads `req.position` and calls `spliceInsertReportingInternal(..., None, ..., explicitRootId = Some(rootId))`. In `PipelineStepRepository.scala` (`existingChildren`, `(None, Some(rid))` case), every parentless step of that root is then reparented under the new row. This matches HEL-1340's probe.md.

**(a) D1: is the UI gap index the backend `trunkOfRoot` index?** Yes, in the normal case.
- `PipelineRiverView.tsx:177-181`: `primarySteps` is the first lane with `parentStepId === undefined && rootId === roots[0].id`.
- The gaps are `renderGap(0)` and `renderGap(idx+1)` with `idx < primarySteps.length - 1` (:350, :457).
- `handleInsertStep` sends `isAppend ? undefined : index`, where `isAppend = index >= stepsRef.current.length` (:764). `handleAddStep` passes `steps.length`, so an append never sends `position`. The gap index is therefore a lane index.
- `buildLaneGraph` (`stepTree.ts:97-200`) picks the head as the first root-level step of that root by `(position, array index)`, and the continuation as the first `position === 0` child. `trunkOfRoot` (`PipelineStepRepository.scala:1222`) uses `childrenOfRoot(...).find(_.position == 0)` and `childrenOf(...).find(_.position == 0)`. Ties break by array order versus `executionOrder` order. The GET returns `executionOrder` order, so after a sync these agree.
- Divergence (non-blocking, see notes): a root whose root-level steps include no `position == 0` step. The frontend still seeds a primary lane from the lowest-position root step, while `trunkOfRoot` is empty.
- Other callers:
  - Patch-set apply/undo never send `rootId` (`PatchSetUndoInverse.scala:136-150`, `PatchSetApplyRollback.scala:322-328`). Unaffected.
  - `handleInstantiateShape` sends `rootId` only for an empty root 0. Unchanged.
  - helio-mcp `add_pipeline_step` IS affected, in a way the design does not account for. See CR1.

**(b) D3: the lane pre-check.** Correct in direction.
- Today `laneCheckF` (`PipelineService.scala:1869-1888`) uses `trunkOf(current).lastOption` over `listByPipelineInternal`. On a multi-root pipeline that is whichever root's `position == 0` head comes first. After the fix, the real anchor for a `rootId` create is that root's trunk-last.
- A non-vacuous red test is achievable. Take R1 A->B and R2 X->Y, and a `lane` `secondaryInput` = Y with `rootId` R2 and no `position`. With the fixed anchor, Y is an ancestor and the request must 422. With the old pre-check, if `trunkOf` resolves to R1, Y is not in {A,B}, so it passes.
- Caveat: which root `trunkOf` resolves to depends on DB row order (ties at `position` 0). The test must seed R1 first and assert that precondition, or it is flaky-vacuous. The red run must also be taken with placement fixed and only `laneCheckF` reverted, or it proves nothing about D3 (see notes).

**(c) D5: the reconcile.** I checked it against `syncStepsFromServer` (:731-746), `handleInsertStep` (:759-814), `handleAddLaneStep` (:831-906), the draft swap in `handleStepConfigChange` (:1104-1152) and `handleReorderSteps`' merge (:1282-1292).
- The functional-updater choice does fix the stale-`stepsRef` hazard.
- "Keep local config" is safe for single-writer editing. Edits are sent from local state, and the in-flight-edit flush at :1119-1145 depends on it.
- The merge rules as written are unsound in two ways. See CR2 and CR3.

**(d) Spec and tasks:**
- Both spec deltas are faithful supersets of the live requirements (`openspec/specs/pipeline-editor-page/spec.md:219-255`, `pipeline-steps-persistence/spec.md:291-308`).
- The backend scenarios are concrete and testable. I re-derived the multi-root expected trunk (X, NEW2, Y, NEW) and it is correct.
- AC1/2 map to tasks 1.1-1.2, AC3 to 2.1, AC4 to 1.4, AC5 to 3.1-3.3.
- The tasks miss an existing backend test and two contract documents. See CR1 and CR4.

**(e) D8: the production check.**
- I searched `docs/` for a documented read-only production DB path and found none. `docs/deployment.md` only documents read-only `gcloud` and Cloud Logging reads. D8's "record AC3 as unverified and escalate" branch is the honest outcome, and C5 forbids improvising.
- The signature is reasonable but undercounts steps. See notes.

**Zero-hit probe:** `grep -n "PipelineStepReparentRoutesSpec|mcp-pipeline-step-placement|create-pipeline-step-request|write.ts"` over the change's `*.md` returned no matches. None of the artifacts below are planned.

### Verdict: REFUTE

### Change Requests

1. **The fix silently breaks a live, tested contract (HEL-1069): plan the updates.**
   - **What is affected:**
     - `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepReparentRoutesSpec.scala:138-146` asserts "422 for a rootId anchor that already has root-level steps, writing nothing". It seeds one root step and posts `{rootId, rejectIfReparents: true}`. Under D1 that request appends onto a childless trunk-last, reparents nothing, and returns 201. The test will go red in task 1.5.
    - The same behaviour is specified in the live spec `openspec/specs/mcp-pipeline-step-placement/spec.md`, scenario "Second same-root branch without an explicit choice" (`rootId=R` ... the tool returns an error).
    - It is also stated to agents in the `add_pipeline_step` description, `helio-mcp/src/tools/write.ts:561`: "rootId on a root that already has steps trips the guard". HEL-1069's archived design.md decision 2 recorded this as a deliberate consequence.
   - **Why it matters:** the design lists "helio-mcp code" as a Non-Goal that "benefits automatically", and says the tool passes `rootId`/`position` through. It has no `position` parameter at all (`write.ts:563-570`). After the fix, the agent-facing description and a live spec scenario would state false behaviour, and an existing test would need an unplanned edit. That is exactly the stop-and-report a careful executor would hit mid-cycle.
   - **Required revision:**
     - Add a `mcp-pipeline-step-placement` spec delta that rewords that scenario for the new `rootId` anchor (trunk-last: guarded only if it has children).
     - Add a task to update the `write.ts` description sentence. Move it out of the Non-Goal, or justify why it stays false.
     - Add a task to update `PipelineStepReparentRoutesSpec.scala:138` in its own commit with the reason. For example, keep a `rootId` guard case that still 422s: `position: 0` on a non-empty root, or trunk-last with a tail.
     - Correct the proposal's "Why" claim that every agent `add_pipeline_step` naming a root was head-spliced. By default the tool sends `rejectIfReparents: true` (`addPipelineStepPlacement.test.ts:35-40`), so those calls were refused, not misplaced. Only explicit `attachAsTail: false` calls were head-spliced. This also matters for interpreting D8's counts.

2. **D5 duplicates the just-created step in the create-immediately branches.**
   - **What's wrong:** `handleInsertStep` and `handleAddLaneStep` never swap the temp id. They discard `createPipelineStep`'s return value (:784, :881) and rely on `syncStepsFromServer`'s wholesale replace to remove the temp step. D5 replaces that call with `reconcileStepsWithServer(prev, fresh)`, whose rules are "every local-only (temp-id) step is kept" and "a server step with no local counterpart is added". Applied there, the temp step stays and its persisted copy is added: two cards for one step, permanently. The temp copy has no backend row, so its edits are silently no-ops.
   - **Required revision:** D5 must specify how the reconcile learns which temp id the create just persisted, and this must not change HEL-1294 semantics (C1).
     - Option (a): the call sites swap temp -> persisted before reconciling. State whether the swap sets `renderKey`. Today the immediate path deliberately remounts, which is why expand is disabled while creating.
     - Option (b): the function takes a `{tempId -> persistedId}` mapping and drops the matched temp.
     - Add a 3.1 unit case and a 3.2 or RTL case for the immediate insert path that asserts exactly one card for the created step.

3. **D5's merge is unsound under the concurrency its own spec scenario names ("another create still in flight").**
   - **Race 1:** draft A's reconcile can run after draft B's POST has committed but before B's `.then` swap. The server list then contains B-persisted with no local counterpart, so it is added, and temp B is also kept. B's swap (`prev.map`, :1123-1131) then turns temp B into a second element with the same persisted id: duplicate React keys and a duplicated card.
   - **Race 2:** if A's GET snapshot predates B's commit while B's swap has already landed locally, the rule "a local persisted step absent from the server is dropped" removes B. B's own later reconcile re-adds it from the server, but without its `renderKey` (the open card collapses) and with the server config (the in-flight edit is lost). This breaks the spec scenario "keeps an open card open".
   - **Required revision:** D5 must define a rule that is safe under overlapping creates, and add tests for both orders. For example:
     - ignore a reconcile whose GET was issued before a later create resolved (a monotonic request counter);
     - do not add server-only ids while any create is in flight, or let the swap merge into an existing same-id element instead of creating a duplicate;
     - never drop a local persisted step whose id came from a create that resolved after the GET was issued.

4. **Missing contract update: the JSON Schema.**
   - **What's wrong:** `schemas/pipelines/create-pipeline-step-request.schema.json` is the API source of truth (CLAUDE.md, "API Contract"). Its top-level description (:5) says `position` is "an integer index (0-based) into the pipeline's current whole-pipeline execution order", validated against the pipeline step count. Its `rootId` description (:35) needs the D1 semantics.
   - **Why it matters:** D9 updates only the Scala scaladoc. After the fix, the schema contradicts the behaviour, which is the very doc/code contradiction AC4 exists to remove.
   - **Required revision:** extend D9 and task 1.4 to rewrite both schema descriptions (root-trunk-scoped `position` when `rootId` is given; the 422 range is that root's trunk length). Run the schema-drift pre-commit check against them.

### Non-blocking notes

- **D1 edge case: a root whose root-level steps have no `position == 0` step.** This can happen with legacy/V94 root-level tails after their trunk head is deleted.
  - The frontend still seeds a primary lane from the lowest-position root step (`stepTree.ts` `sortSiblings` + queue), but `trunkOfRoot` is empty.
  - After the fix, a gap insert at k>0 there returns 422, and an append still reparents every parentless step of the root (head-splice).
  - It is rare, but name it in Risks, or have the resolver mirror the frontend's head rule.
- **D3 red evidence:** take it with the placement fix applied and only `laneCheckF` reverted. Against fully unmodified code, the same 422 assertion could be red for reasons unrelated to D3. Assert the precondition that `trunkOf(current)` resolves to R1, so DB row order cannot make the test vacuous.
- **D3 wording:** "when the root is unknown, laneCheckF does not fail itself" is ambiguous about whether `validateLaneReference` still runs; it can 422 on a bad lane reference first. Say "skip the ancestor computation, use no ancestors", so the unknown-root 422 still comes from `persistNewStep`.
- **D8 undercounts steps:** each later head-splice makes the previous head non-parentless. "Parentless N with an older child" therefore finds about one step per affected pipeline. Pipeline counts are fine. For step counts, consider "any step N with a child A where `A.created_at < N.created_at`" (on or after 2026-09-05), and disclose that reorders and deliberate gap-0 inserts produce false positives.
- **D2:** append onto a trunk-last step that has tails reparents those tails (documented). With MCP's default `rejectIfReparents`, that case now 422s where it previously also 422'd, so there is no regression. Worth one line in the CR1 spec delta.
- **D6 note:** HEL-1340 is not on main at this HEAD (`git log -3` shows HEL-1336/1286/1346). The D6 stop-before-group-3 gate is the right control.
