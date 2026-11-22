## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 4f57c50019253cfd763ef7374b81733ec4e948ec (planning artifacts untracked in the change dir).

### What I verified (with evidence)

1. **`removedPlacementCount` is 0 on every reachable path except the documented race: holds.**
   - `PatchSetUndoService.scala:131`: the `pipelineStep` create arm runs only inside `ifStillUnbound`. That re-checks
     `PatchSetUndoBoundPanels.blockingPanelIds` and `PatchSetUndoLaterChildren.blocking`, with Outputs excused only by
     same-set `output` create `newId`s.
   - `countPlacementsForStep` (`:418-425`) counts panels on Outputs whose `node.stepId` equals the created step. Such an
     Output must be either (a) added later, which LaterChildren blocks, or (b) a same-set Output create.
   - (b) is impossible, for three reasons:
     - `PatchSetOutputResolvers.scala:116-174` judges `nodeStepId` against the pipeline's SAVED steps.
     - `PatchSetRefs` resolves `$ref` only from a panel create to an Output create. `git grep` shows the only use sites
       are `PatchSetPanelResolvers:118-121` and the apply substitution.
   - An Output cannot be moved onto the step later:
     - `UpdateOutputRequest(name, config)` has no node field.
     - `PipelineDraftWrites.scala:227` says "the node, root, kind and schema are not draft-editable".
   - So a set-created Output cannot end up on the set-created step. The count can only be non-zero in the
     `ifStillUnbound` race window.
2. **No consumer reads the field: holds.**
   - `git grep removedPlacementCount` outside archives finds three hits:
     - the producer (`PatchSetUndoService:411`);
     - the lane spec assertion (`PatchSetUndoLaneSpec:138`);
     - the misnamed internal doc in `PipelineStepRepository:1027`, an explicit non-goal.
   - The `resultingState` readers in frontend/helio-mcp are generic. `warmListeners.ts:78` reads `resultingState?.id`,
     and `patchSetsSlice.ts` reads `dashboardId` or a dashboard shape. Neither reads the count, and a step create-undo
     has no `id` in `resultingState` today either.
   - `schemas/patch-sets/patch-set-undo-response.schema.json` already describes `resultingState` as "Absent for a
     'restored' create-undo".
3. **Spec delta (REMOVED+ADDED): accurate.**
   - The REMOVED name matches the canonical `patch-set-lane-edits` requirement exactly.
   - The ADDED text agrees with `patch-set-undo` "Undo SHALL refuse when a resource it would delete carries panels…"
     (HEL-1720) and "…Outputs or pipeline steps…" (HEL-1795).
   - The refusal scenario "naming the panel" is true: `PatchSetUndoConflictCheck.guarded` (`:56-68`) concatenates the
     bound-panels and later-children blockers, and `PatchSetUndoLaneSpec:116` asserts the panel name.
   - The rejoin scenario matches `checkPipelineStepCreate` (`:254-280`).
   - `openspec validate tidy-patchset-undo-service --strict` prints "Change 'tidy-patchset-undo-service' is valid".
4. **D2 split is behaviour-preserving as planned.**
   - The only `log` call is in `restoreAll` (`:105`), which stays in the service.
   - Five specs attach a `ListAppender` to `LoggerFactory.getLogger(classOf[PatchSetUndoService])` (BoundOutputPanels,
     DatasetLaterWork, LaterAlertRules, InlineDatasetLaterWork, LaterOutputs). Keeping the logger in the service keeps
     them valid.
   - The moved restorers make no log calls. `restoreBoundOutputs` needs only `context.outputRepo`, `panelService` and
     the EC.
   - Fourteen sites construct `new PatchSetUndoService`. D2 freezes the constructor, so they are unaffected.
   - The evidence plan (D4 before/after records with counts, plus a `git diff --stat` showing no `src/test` in the split
     commit) proves the split adequately.
5. **D1 byte-identical failure strings: achievable.**
   - `restoreCreateUndo`'s missing-newId text (`:201`) is
     `edit ${edit.index} (${edit.targetKind} ${edit.op}): journal is missing its captured newId`. For this arm it
     renders exactly as the hand-written `edit N (pipelineStep create): journal is missing its captured newId` (`:402`).
   - Both arms map a delete failure through `restoreFailed(edit, err.message)`.
   - `PipelineService.deleteStep` returns `Future[Either[ServiceError, DeletePipelineStepResponse]]`, so
     `.map(_.map(_ => ()))` fits.
   - `panelRepo.countByOutputIdsInternal` has another caller (`OutputService.scala:102`), so it stays. The design
     already says to check this.
   - The removal drops one failure path: an exception from the count reads, which `safeRestoreOne` turned into a
     `Left`. That is acceptable and inherent to the removal.
6. **D3 `ConcurrentHashMap`: sound.**
   - `PatchSetApplyService.scala:135-181`: the map is written only in the success path of each step and read only by
     `journalSuccess`. The `Left` branch passes `appliedSoFar` to rollback and never reads it.
   - Threading an immutable map like `children` is equivalent.
7. **D5 guard tests: checked against the code and the canonical spec. One plan is wrong (CR1).**

### Verdict: REFUTE

### Change Requests

1. **D5(a) (and task 3.1) states the opposite of current behaviour, and its mutation would not make the test fail.**
   - **What the code does:**
     - `PatchSetUndoDatasetLaterWork.inlineFindings` (`PatchSetUndoDatasetLaterWork.scala:66-69`) treats an inline
       source with `refs.panels.nonEmpty` as *referenced* and **skips** it (returns `None`). It never blocks.
     - The canonical requirement agrees ("Undo SHALL refuse when a pipeline create's undo would delete an inline dataset
       root with later work", `openspec/specs/patch-set-undo/spec.md:387-391`): "Undo SHALL skip a source that still
       exists and is referenced by anything other than the pipeline being undone, since that source is kept."
     - HEL-1493 cleanup then reports it `kept`.
   - **The gap this guard should close:** HEL-1796's `skeptic-final-2.md` (archive `2026-11-21-datasource-undo-later-work`,
     line 57) says: "No test covers a form-panel reference on an inline root (`refs.panels.nonEmpty`)."
   - **What D5(a) says instead:** "a form panel bound to that root data source added later → undo refused … and nothing
     removed". Written as specified, the test fails on current code. The executor would then face a "guard red on
     current code" situation, with a pull towards changing the refusal rule, which is an explicit non-goal.
   - **Revise D5(a), task 3.1 and the proposal's "a form panel bound to an inline root refuses the undo" bullet:**
     - **Setup:** a `pipeline` create with an inline `dataset` root. After the apply, append a row to that source, which
       is the later work that *would* refuse when the source is unreferenced. Then bind a `form` panel to the source.
     - **Expected:** the undo **succeeds** and the pipeline is gone. The outcome's `inlineSources` lists the source as
       `kept`, and the source and all its rows remain.
     - **Mutation:** drop `refs.panels.nonEmpty` from `referenced` in `inlineFindings`. The undo is then refused with
       the inline later-work conflict, so the test goes red.
     - **Why the appended row is required:** without it, the mutation leaves `blockingSource` empty and the test stays
       green, so the mutation would not bite.
2. **Pin down the D5(b) mutation and how it relates to the existing tests.**
   - `PatchSetUndoLaterAlertRulesSpec` already has two tests on this path:
     - `:285` "excuse the roots the create itself made (several), and undo cleanly";
     - `:316` "excuse the journaled rootIds regardless of timestamps".
   - Both use `sourceId` roots, not inline roots. So an inline-root guard is still new, but the design's "confirm absence"
     step must record that these exist and why (b) still adds coverage.
   - "Stop excusing `rootIds`" is ambiguous. If the mutation makes `children.flatMap(_.rootIds)` evaluate to `None`, the
     `created_at <= appliedAt` fallback (`PatchSetUndoLaterChildren.scala`, `rootExcused`) still excuses the create's
     roots under a real `appliedAt`. The full-undo guard then stays green and the mutation proves nothing.
   - **Specify the mutation** as making the `Some(ids)` branch excuse nothing (e.g. `case Some(ids) => false`). Record
     that it turns (b) red.

### Non-blocking notes

- **The ADDED requirement overstates the guarantee.** It says "Undo SHALL NOT delete an Output, a pipeline step or a
  panel placement that the patch set did not create" without qualification, but the design keeps the accepted residual
  window at `ifStillUnbound`. Consider adding "detected before the delete (see `patch-set-undo`)" or a short note
  pointing to the residual.
- **The carried-over atomic paragraph is worded more strongly than the code.** "if any part of the removal cannot be
  performed, the whole undo is refused and nothing is removed" is accurate for the single step delete (one
  transaction). It is weaker than it reads for a multi-edit Phase-2 failure, where the walk does not compensate. This is
  pre-existing wording.
- **D3 `describeRoot`:** the plan to verify that data sources have no sharing before rewriting the comment, and to raise
  a follow-up otherwise, is correct. Keep it evidence-backed: cite the migration or RLS policy in the commit or PR.
