## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 4f57c50019253cfd763ef7374b81733ec4e948ec. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

1. **Round-1 CR1 (D5(a) direction and mutation) is fixed, and the fix is correct against the code.**
   - `PatchSetUndoDatasetLaterWork.scala:67-69`: `referenced` includes `refs.panels.nonEmpty`, and a referenced source
     returns `None`. It is skipped and never blocks.
   - `DataSourceReferenceRepository.scala:90-96`: a `form` panel whose `form_config->>'dataSourceId'` points at the
     source is a reference. It is visible when the dashboard is the viewer's own, so it lands in `panels`, not in
     `hiddenPanelCount`.
   - `InlineSourceCleanup.scala:132,191`: such a source is reported `KeptReferenced` ("form panel ..."), which becomes
     `kept`.
   - With the mutation, `referenced` becomes false and `blockingSource` sees the appended row. The existing
     `PatchSetUndoInlineDatasetLaterWorkSpec:211` already proves that an append on an unreferenced inline root refuses.
     So the mutation bites, and the "keep the appended row" note is right.
   - No existing test covers a form-panel reference. The specs at :263, :275 and :357 use pipeline references only.
2. **Round-1 CR2 (D5(b) mutation) is fixed and sound.**
   - `PatchSetUndoLaterChildren.scala:69-73`: `case Some(ids) => false` blocks every root once `rootIds` is journaled.
   - `PatchSetApplyService.scala:209-216` journals `rootIds` from `listRootDataSourceIdsInternal`. I checked that `_1`
     is the `PipelineRootId`, which is the same id space as `r.id`. So the mutation reddens an inline-root undo.
   - The `None`-yielding mutation is correctly excluded, because the `created_at` fallback would still excuse the roots.
3. **D1 (removal, byte-identical strings) holds.**
   - `restoreCreateUndo` (`PatchSetUndoService.scala:200`) renders `edit N (pipelineStep create): journal is missing
     its captured newId`, which is identical to the hand-written string at `:402`. Both arms map a delete `Left`
     through `restoreFailed(edit, err.message)`.
   - `git grep removedPlacementCount` outside the archives finds only three places:
     - the producer (`:411`);
     - `PatchSetUndoLaneSpec:138`;
     - the misnamed internal doc at `PipelineStepRepository:1027`, which is a declared non-goal.
   - The schema (`patch-set-undo-response.schema.json:39`) already says `resultingState` is "Absent for a 'restored'
     create-undo".
   - A schema-validation helper exists (`com.helio.testsupport.JsonSchemaValidation`, used by `AskSeamSpec:118-120`), so
     the conditional in D1's seam step resolves to "use it".
4. **D2 (split) is behaviour-preserving as planned.**
   - The only `log` call is in `restoreAll` (`:105`), which stays in the service.
   - The five specs that attach a `ListAppender` all target `classOf[PatchSetUndoService]`:
     BoundOutputPanels, DatasetLaterWork, InlineDatasetLaterWork, LaterAlertRules and LaterOutputs.
   - No test uses `PrivateMethodTester`/`invokePrivate`.
   - The restorers named for the move (`:233-398`) make no log calls.
   - Removing about 165 lines plus D1's `countPlacementsForStep` leaves the service near 240 lines, which matches the
     target.
   - The evidence plan proves the split adequately: before/after counts on the D4 set, and a `git diff --stat` showing
     no `src/test` path in the split commit.
5. **Spec delta.**
   - The REMOVED header matches the canonical `openspec/specs/patch-set-lane-edits/spec.md:36` exactly.
   - The ADDED text agrees with `patch-set-undo` "…carries panels the patch set did not create" (:259) and "…Outputs
     or pipeline steps…" (:292).
   - The surviving scenarios (trunk intact, rejoin refusal, delete-lane restore) carry over verbatim.
   - `npx --no-install openspec validate tidy-patchset-undo-service --strict` prints "Change
     'tidy-patchset-undo-service' is valid".
6. **D3 checks.**
   - The `ConcurrentHashMap` (`PatchSetApplyService.scala:135,158,181,274,289`) is written only on success and read
     only by `journalSuccess`, so threading an immutable map is equivalent.
   - No test asserts the old warning text.
   - Migrations show only `data_sources_owner` (V35:43) as a `data_sources` policy, with no grant `resource_type` for
     data sources. That is consistent with the planned "owned == readable" comment, which the executor must still
     cite.

### Verdict: CONFIRM

### Non-blocking notes

- **D5(b): inline-root excusal is already exercised.**
  - `PatchSetUndoInlineDatasetLaterWorkSpec:202` ("succeed ... when nothing changed (guard)") undoes a pipeline create
    with an inline root, and it will also turn red under `case Some(ids) => false`.
  - The new guard is still worth adding as explicit, labelled coverage. The evidence should say so honestly, rather
    than imply that no inline-root test existed. Consider making it multi-root, and asserting that no root appears in
    `PatchSetUndoLaterChildren.blocking(...).roots`, so it is not a duplicate of :202.
- **D1 seam red.** Schema validation alone will not go red on current code, because `resultingState: {object}` is
  schema-valid. The red must come from the "no `resultingState` key" assertion. Record which assertion produced it.
- **ADDED requirement wording.** "Its accepted residual window" points at the `patch-set-undo` capability, but that
  capability's text does not literally state a residual window; it lives in code docs at `ifStillUnbound`. This is
  harmless, but a reader following the reference will not find it.
- **`tasks.md` cleanup.** `tasks.md` has an empty "## Standing Constraints" heading; fill it or drop it.
- **D1 removes an exception path.** The count reads can no longer throw into `safeRestoreOne`. This is inherent and
  acceptable; mention it in the PR.
