## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `849dd96c936182d4a8c8597c3cbdc92ae39fcb82`. The change dir is untracked, so the artifacts were read from the working tree. Source paths below are relative to `backend/src/main/scala/com/helio/`.

### What I verified (with evidence)

- **Cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/shared-step-reference-checks/HEL-1515`.
- **Round-1 #1 (unobservable mutation d):** mostly addressed. D2 now:
  - states that the three stages are disjoint;
  - drops the swap among ownership, lane and upsert;
  - adds d1 and d2, and says per path which ones are expected to go red;
  - restates D1's ordering claim.
  
  I checked the d1 claims against `services/pipelines/PipelineStepCreate.scala` L118-146. Today create runs acl, then lane, then `findByIdShared`, then `requireEditorAccess`, then `upsertOwnershipCheckF`. Under d1, a viewer with an ancestor lane would get 403 instead of 400, and a no-access caller with a foreign source would get "Pipeline not found". Both are correct. **But d2 is not constructible as specified** (see CR1).
- **Round-1 #2 (create placement arms):** mostly addressed. I checked each listed arm against `persistNewStep` (L162-326) and against `spliceInsertReportingInternal` (`infrastructure/persistence/pipelines/PipelineStepRepository.scala`):
  - `(None, Some(rid))` re-parents only that root's parentless steps (L39-40 of the method).
  - Otherwise it re-parents `siblingsQuery(pipelineId, anchor)` (L41).
  - `attachTailInternal` re-parents nothing (L237).
  - The `resolveRootTrunkAnchor` arms are at `PipelineService.scala` L380-406.
  
  All the listed arms are correct. **However**, the round-1 sub-item "(g) … out of range gives the empty set" was dropped from the position arm, and the arms that persist rejects are not specified (see CR2).
- **Round-1 #3 (ancestor/anchor mismatch):** addressed. Option (i) was chosen: ancestors stay as they are, and the self, missing and ancestor branches keep precedence, so the overlap keeps today's "ancestor" message. The mismatch is listed as a follow-up in the Planner Notes. I confirmed the mismatch is still present: the ancestors come from trunk-last at L110-113, and the insert anchors at `current(index - 1)` at L314.
- **Round-1 #4 (transitive lane cycles):** addressed. Option (i) was chosen: a dependents closure over parent edges plus lane edges. The cycle condition is "the new edge X -> A closes a cycle iff X already depends on A". Under that condition the closure is complete. The duplicate-keeps-empty argument still holds: the clone's dependents are a subset of the original's dependents, so a hit means the original was already cyclic. The spec text and the new "depends on this step" message are consistent with this.
- **Spec delta:** both MODIFIED headers match `openspec/specs/pipeline-lane-rejoin-input/spec.md` verbatim. Every pre-existing scenario is retained, including the run-time scenario, and the additions are scoped to the new set.
- **Update / duplicate chains:** checked at `PipelineStepWrites.scala` L94-125 and L304-341.
  - Update and duplicate already hold `pipeline`, so a `beforeUpsertF` of `Right(pipeline)` is trivial for them. D2's "d1 stays green on update and duplicate" is correct.
  - `upsertOwnershipCheckF` (`PipelineServiceSupport.scala` ~L189) needs `pipelineOwnerId`, which matters for CR1.
- **AC coverage:**
  - AC1 is covered by D1, D2, 1.3-1.5.
  - AC2 is covered by D3 and 3.1.
  - AC3 is covered by D4, 1.2, 1.6 and 3.2, with C1 for the product call.
  - AC4 is covered by D5, 2.1 and 3.3.
  
  There are no placeholders and no `TODO` or `TBD` items.

### Verdict: REFUTE

### Change Requests

1. **D2 mutation d2 cannot be built in the shared method, so the executor will stall or fabricate. This is the same failure mode as round-1 #1.** D1's signature takes `upsertOwner: A => UserId`, where `A` is produced by `beforeUpsertF`. `upsertOwnershipCheckF` genuinely needs the pipeline owner (`PipelineServiceSupport.scala`, `UpsertTargetCheck.check(cfg.target, ownerUser, …)`). So "run upsert before `beforeUpsertF`" has no owner id to check against. Also, create's editor check lives inside create's own `beforeUpsertF` thunk, not in the shared method, so no edit to the shared method can move the upsert stage ahead of the editor check. Revise D2 and task 1.5:
   - State that "upsert after `beforeUpsertF`" is enforced structurally by the data dependency (`A => UserId`), and drop d2 as a mutation.
   - If an observable guard is still wanted for "the editor check precedes upsert on create", define it as a mutation of create's `beforeUpsertF` call site. The new test would then be: a viewer with an upsert target not owned by the pipeline owner gets 403 today. Label that test as guarding create's call site, not the shared method.

2. **Specify empty create seeds for every placement that `persistNewStep` rejects, and restore the round-1 out-of-range item.** The lane check runs before `persistNewStep`'s own validation. Two problems follow:
   - **Position out of range.** The `(None, None)` + `position = k` arm, written as "children of `current(k-1)`", has no range guard. For `k > count` or `k < 0`, `current(k-1)` throws an `IndexOutOfBoundsException` inside the lane `Future`. That produces a 500 where today the response is persist's 422 "position must be between 0 and N" (the guard at L300 runs only after the lane check).
   - **Already-rejected placements would get a new message.** Today a lane to a non-ancestor passes the lane check, and persist then returns its own message:
     - `(Some(parent), Some(root))`: 400 "Cannot name both parentStepId and rootId…" (L179-185).
     - `(None, None)` on a pipeline with more than one root: 400 "This pipeline has N roots…" (L260-263).
     - Unknown `rootId`: 422 (L201-202).
     - Unknown `parentStepId`: 422 (L226-229).
     
     If seeds are computed naively for these, a lane to a would-be child turns those messages into the new 400 "depends on this step". That violates C2 and AC1 ("every existing status and message unchanged").
   
   Fix: add to D4 and task 1.6 that seeds are empty whenever persist would reject the placement. That covers both ids given, more than one root with neither id, an unknown root, an unknown parent, `rootId` with `Left`, and `position` outside `0..count`. Add a test for the out-of-range-position-plus-lane case that asserts today's 422 message.

3. **Make proposal.md agree with design.md.** `proposal.md` says the fix ships only "if … the owner confirms (escalated)". That contradicts C1 and the design's Planner Notes, which build it as an ASSUMED call parked for the owner. The proposal also scopes the rejection to "the referencing step's own descendant" and to "a create spliced in front of existing steps". D4 and the spec delta are broader: dependents through parent or lane edges, and any re-parenting placement, including a plain append onto a trunk-last that has a tail. Update the What Changes and Modified Capabilities bullets so the archived proposal describes what ships.

### Non-blocking notes

- **Seeds and the closure result.** For create, say that the closure result includes the seeds. The re-parented steps themselves become dependents. Update excludes `existing.id`, which reads as the closure including its seeds, but create should say so explicitly.
- **Lane referrers.** The closure has to decode every stored step's config to find its lane referrers. Reuse `PipelineStepConfigCodec.secondaryLaneStepId` over the already-fetched `current` list. Don't add a second fetch.
- **Message mutation coverage.** The mutation in 3.2 ("drop the branch") should also be checked against the update-transitive test. The parent-only closure would pass the direct case and fail only the transitive one, so make sure some mutation that falls back to parent edges only turns the transitive test red.
- **Carried over from round 1:** the existence oracle on create's lane check, and the `rejectIfReparents` precedence. Both are already in the Planner Notes. That is fine.
