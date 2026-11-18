## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: `aeeb6867500663652295876f3970001c2d69ef55` (change dir untracked; artifacts ticket/proposal/design/tasks/specs read in full).

### What I verified (with evidence)

- **Fingerprint already covers roots: TRUE.** `PatchSetTargetFingerprint.scala:43` allowlists `"roots"` for `pipeline`;
  `PatchSetPipelineDefinition.assemble` (line 67) writes `{id, dataSourceId}` per root from `findDefinitionHeadAction`, whose
  `allRootsQuery` sorts by `(pipeline_id, position)` (`PipelineRepository.scala:256-261`). So root add/remove AND root
  position order change the fingerprint. (Consequence used in CR2 below: a restore that puts a root at a different position
  does not reproduce the pre-save fingerprint.)
- **Draft-root sample access needs no backend change: TRUE.** `SourceSampleService.authorized` (lines 70-78) serves
  `findByIdOwned` first and only falls through to the pipeline-scoped grant on `None`. Draft-preview `roots` are synthetic
  client labels, never stored roots (`schemas/pipelines/draft-preview-request.schema.json` description), so draft-root frames
  need no server change either.
- **Lock order O\* with site (0) inside the save: sound in principle.** `docs/live-draft-preview.md` 8.3.1 defines (0) as
  `data_sources` rows; the standalone root add already takes (0) `FOR KEY SHARE` before (2)/(3)
  (`PipelineRootRepository.add`, line 98); source delete takes (0) `FOR UPDATE` then (1) then (3). Placing (0) before
  `lockDefinition`'s (1) keeps the order. `lockForDeletion(pipelines = Seq(pid))` does cover every Output of the pipeline
  (V129: `o.pipeline_id = ANY(p_pipeline_ids)`), so (1) already covers root-node Outputs on a removed root. The post-re-plan
  subset guard mirrors the existing `needsAdvisory`/`checkedKeys` guards in `DraftSaveTransaction.run`.
- **Cycle check: adequate.** `checkAddReadAction` checks the new read source against the pipeline's STORED write targets
  only; D4's use of FINAL write targets from the plan is the correct extension, and because D5 inserts root rows before
  `insertSteps`, the existing `upsertCycleCheck` -> `checkAddWriteAction` (which derives `ownReadSources` from DB read edges)
  also sees the new roots. Run under the already-held advisory lock: correct.
- **Undo journal:** `DraftSaveJournal.priorState` records root ids only; `DraftRestore.requestOf` ignores them (confirmed).
  `dependentsOfCreatedOutputs` already covers Outputs created on an added root.
- **Node snapshots:** `removeRootCascadeAction` (`PipelineStepRepository.scala:1277-1296`) deletes by step and by
  `root_id AND node_step_id IS NULL`; `deleteStepsCoreAction` (line 1107) deletes step rows only. D5's claim is accurate.
- **Lane references into a removed root's subtree** are already refused by `DraftDiff.requireLaneTargetsExist` (equivalent of
  the standalone R7 phase-1 check 2).
- **Client claims:** `DraftOverlay` is `version: 3` (`pipelineDraft.ts:19`); `readKeptDraft` accepts 2/3 and validates op by op;
  `DRAFT_BLOCK_REASON` flows via `usePipelineDetailPage.ts:173` into the spine, mobile header and presentation hook.
- **DB constraints (decisive for CR1):** `V98__pipeline_roots.sql:84` declares `UNIQUE (pipeline_id, position)` (not
  deferrable; no later migration alters it); `V99` adds a `FOR EACH STATEMENT AFTER DELETE` zero-root trigger.
  `classifyPsqlException` (`PipelineService.scala:457-466`) maps a unique violation to 500 and an FK violation to a generic
  404 "Referenced resource not found".
- **No duplicate-source rule exists anywhere today:** `PipelineRootWrites.attachRoot` / `PipelineRootRepository.add` add a
  root on any owned source with no check; grep for any such rule in `backend/src/main/scala` found none.

### Verdict: REFUTE

### Change Requests

1. **D5 apply order violates `UNIQUE (pipeline_id, position)` on the most common combined edit.** D5 inserts new roots "at
   final positions" BEFORE deleting removed roots and compacting survivors. Example: stored `[A@0, B@1]`, draft removes A and
   adds C. Final is `B@0, C@1`; inserting `C@1` while `B@1` still exists raises 23505, which `classifyPsqlException` turns into a
   500. Replacing a pipeline's only root (remove A, add C) collides the same way at position 0. Revise D5 to an order that
   satisfies both constraints. One that works: insert new roots at non-colliding positions (stored max + 1 + i), then the
   deletes, then the root-row deletes (the statement-level zero-root trigger is then safe, because a new root already exists),
   then compact every survivor and new root to the final dense order (reuse `compactPositions`, which walks ascending
   positions so each update moves into a freed slot). Add `DraftSaveApiSpec` cases "remove the first root and add one" and
   "replace the only root" to tasks 3.1. Both must fail against the D5 order as currently written.

2. **D2 contradicts D7 and the undo spec scenario about root positions.** D2 and the spec ("A new root SHALL be appended
   after the surviving roots") put every new root after all survivors. A restore of a removed root that was not last (stored
   `[A@0, B@1]`, save removes A, undo recreates A) would therefore yield `[B@0, A@1]`. Roots are fingerprinted in position
   order (verified above), so the result cannot equal the pre-save fingerprint that the "Undo a root removal" scenario and
   task 3.3 require. It would also change cross-root tiebreak order (R3). D7 records `position` in `rootDefs` but nothing
   consumes it. Decide and write down:
   - (a) The final position of every root is its index in the `roots` array.
   - (b) In Public mode, survivors must keep their stored relative order, and you choose whether new roots may be
     interleaved or must come after all survivors.
   - (c) In Restore mode, the array is built from `rootDefs` in position order, so original positions are restored.

   Update the spec text to match, and make task 3.3 explicitly undo the removal of a root at position 0 of two.

3. **The "same source is a root twice → 400" rule is a new restriction, and as written it can break saves and undo.**
   Nothing in the standalone add or create paths forbids duplicate sources today, so stored pipelines may already have them.
   As specified, the rule applies to the whole final root list. That means any draft save carrying `roots` on such a pipeline
   is refused. So is an undo (Restore builds `roots` from `rootDefs`) of a save made before the duplicate existed. Either
   drop the rule, or scope it explicitly to a new root whose source is already in the final list, exempting stored survivors
   and Restore mode. State in the design why it differs from `POST /roots`. If the rule stays, the client add-source flow
   needs to say what it does with a source that is already a root.

4. **D6's race claim is wrong for Public mode, and the (0) lock's empty result is unspecified.** D6 says the source "cannot
   be deleted between check and insert". But the ownership check runs before the transaction, so a source delete can commit
   between that check and the (0) `FOR KEY SHARE`. The lock then matches zero rows and the root insert hits the FK. Specify
   that site (0) returns the locked ids. If any added source is missing, the save aborts with 404 `Data source not found`
   (Public; the same message as `attachRoot`) or 409 (Restore, already in D6), with nothing written, instead of relying on the
   FK violation and the generic classifier. Pin it in the `DraftSaveRaceSpec` "source delete, writer-first" case
   (task 3.2).

### Non-blocking notes

- D4/D5 run the cycle checks while removed roots' read edges are still in the table, because root rows are deleted after
  `insertSteps`. A draft that removes a root specifically to break a would-be cycle while adding the write in the same save
  gets a conservative false 400. Acceptable, but state it.
- `DraftSaveRequest` root items in Restore mode need `{id, sourceId}`, a shape D1's `{id} | {clientId, sourceId}` does not
  list. Also say whether a Public `{id, sourceId}` for a survivor is a 400 or ignored.
- Task 1.1 says "the three `schemas/pipelines/draft-save-*` schemas", but the cascade schema is
  `draft-cascade-required-response.schema.json`.
- `readKeptDraft` should reject a root op inside a v2/v3 blob, as it already rejects an Output op in v2.
- Deadlock coverage: besides source delete and teardown, the dataset writers (`DataSourceRepository.lockSource`,
  `FOR UPDATE`: append, replace, refresh, form submit) conflict with site (0)'s `FOR KEY SHARE`. The standalone root add
  already has the same exposure. Still, the deadlock spec or `g1-writers.md` should state that none of them takes (1)-(5)
  after the source row.
- Restore mode skips the caller-ownership check on recreated roots. That is reasonable for undo, but say who can undo
  (any editor vs. the saving actor), since the source may belong to another user.

### Gate defects

None observed.
