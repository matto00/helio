## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: `aeeb6867500663652295876f3970001c2d69ef55`. The change dir is untracked. I read the current ticket, proposal, design, tasks and all three spec deltas in full, and checked them against the code.

### Prior change requests: resolved or not

1. **CR1 (D5 order vs `UNIQUE (pipeline_id, position)`): RESOLVED.** V98:84 is `UNIQUE (pipeline_id, position)`, and nothing in V98 or later migrations adds a CHECK on `position`, so the temporary negative positions in D5 are legal. D5 now applies in this order:
   - insert at `storedMax + 1 + i`;
   - steps, relinks, `deleteRemoved`;
   - node_snapshots, then the root-row delete (the V99 statement-level zero-root trigger is satisfied, because the new root already exists);
   - move roots to their final index.

   The two Public collision cases (replace the only root; remove the first root and add one) are both in task 3.1 and both in the spec. In Public mode no root's final index exceeds its current position, so an ascending in-place update always moves into a freed slot.
2. **CR2 (positions vs fingerprint on undo): RESOLVED.** D2 now fixes three rules:
   - (a) position = array index;
   - (b) in Public mode, survivors keep their stored relative order and new roots follow every survivor; anything else is 400;
   - (c) Restore builds the list from `rootDefs` sorted by position, with interleaving allowed.

   The spec text matches. Task 3.3 now undoes the removal of the root at position 0 of two and checks that the fingerprint equals the pre-save one. That is exactly the case where the target is taken: `[B@0]` plus restored `A@1` needs B to move 0 to 1 while A sits at 1. D5's two-pass `-1 - index` shift handles it.
3. **CR3 (duplicate-source rule): RESOLVED.** The rule is dropped (D2), with the reasons stated. The client add-source flow is unchanged.
4. **CR4 (race between the pre-check and the lock): RESOLVED.** D4 says site (0) returns the locked ids. A missing id gives Public 404 `Data source not found: <id>` or Restore 409, with nothing written and no FK violation. The spec scenario "Added source deleted before the save locks it" and task 3.2's "source delete writer-first answers 404 not 500" pin it.

Round-1 non-blocking notes are all taken up:
- The conservative cycle 400 is stated in Risks.
- The Restore item shape `{id, sourceId}` and the Public survivor-with-`sourceId` 400 are in D1.
- The schema name `draft-cascade-required-response` is fixed.
- The keptDraft v2/v3 root-op rejection is in task 2.1.
- The dataset writers are in Risks and task 3.2.
- Undo authority is stated in the Planner Notes.

### What I verified (with evidence)
- `DraftSaveTransaction.run` (lines 67-94): the order is `lockDefinition`, then the fingerprint compare, then `readRows` and the re-plan. After that come the `needsAdvisory`/`checkedKeys` subset guards and the cascade gate. Site (0) before `lockDefinition`, plus an `addedSourceIds` subset guard after the re-plan, slots into this cleanly.
- `PipelineDraftWrites.lockDefinition` (lines 86-113): the order is panels (1) via `lockForDeletion(pipelines = Seq(pid))`, then advisory (2), then (3), then rules and Outputs. This matches D4 and `docs/live-draft-preview.md` 8.3.1, where line 492 defines step 0 as `data_sources` rows with `FOR KEY SHARE` by a root add.
- The undo stale guard holds. `DraftRestore` uses the post-save fingerprint as `baseFingerprint` (DraftRestore.scala:17, 93-110). A root added or removed between the save and the undo therefore makes the undo answer 409, and Restore never runs against moved roots.
- Undo authority claim: TRUE. `PatchSetApplicationRepository.findById` (line 96-100) filters `ownerId === caller`.
- `DraftSaveJournal.priorState` writes only `roots: [ids]` today. `prior` (the fingerprinted definition) carries `{id, dataSourceId}` in position order, so `rootDefs` can be derived from data already in hand.
- `PipelineCycleGuard.checkAddReadAction` (lines 117-136) = `lockAction` + read/write edges + `PipelineCycleValidator.checkNoCycle`. D4's "call the validate part under the already-held advisory" is implementable from existing pieces.
- Standalone removal comparison: `PipelineRootRepository.removeRoot` = `removeRootCascadeAction` (node_snapshots by step and by `root_id`, then steps), then the root delete, then `compactPositions`. D5 reproduces the snapshot cleanup. Outputs, steps and binary_refs cascade on root delete (V98:119/145/147) only as a backstop, as D5 states.
- Client: `pipelineDraft.ts:19` has `version: 3`. `keptDraft.ts:102,108` accepts v2/v3 and already rejects Output ops in v2, so the v4 pattern is established. `useSourceSamples.ts` exists, and `DRAFT_BLOCK_REASON` is used in `usePipelineDetailPage.ts` and `usePipelineDraft.ts`. The op kinds in `draftOps.ts` include `reorder` with a `rootId`, which D9's "a later op naming a removed root is dropped" covers.

### Verdict: CONFIRM

The design is sound enough to implement. Every round-1 change request was fixed in substance, not reworded, and I found no new blocking defect.

### Non-blocking notes
- D5 says the root-move strategy "must be proven by the two collision cases in task 3.1". Both of those cases are ascending-safe Public cases. The case where the target slot is taken arises only in Restore, and task 3.3 (undo of position 0 of two) is the test that exercises it. Point D5 at 3.3, or the executor may prove only the easy path.
- D6 still says the source "cannot be deleted between check and insert". That is true only from the (0) lock onward. D4 now covers the gap between the check and the lock, so tidy the wording.
- Root-row writes (the delete and the position updates; position is part of a unique index, so its UPDATE conflicts with `FOR KEY SHARE` from binary_refs/Outputs FK inserts) happen after (5) in the save. Task 3.7 updates 8.3.1 only for site (0). The doc should also record where `pipeline_roots` row locks fall in O*. The standalone remove has the same exposure via `compactPositions`.
- D3: a stored step under a removed root that the draft relinks to a surviving root has no stated outcome, either allowed or 400. Only "a step still naming a removed root is 400" is stated. Both are safe, but the executor should pick one and test it. The client never produces this case, because rootRemove drops the subtree.
- D4 cycle check in Restore mode: a restored root that would now close a cycle gives a 400. A 409 "Undo refused" would match the other Restore refusals.
- `addedSourceIds` can contain the same source twice (duplicates are allowed). Compare the locked ids as a distinct set.
- D9 does not say that `buildDraftSaveRequest` maps a step's draft-root `clientId` to `rootClientId`. D1 implies it.

### Gate defects
None observed.
