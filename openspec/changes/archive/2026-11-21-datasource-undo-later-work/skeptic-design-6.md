## Skeptic Report — design gate (fold-in round 1, skeptic-design-6.md)

Scope: the added D9 scope only (inline `dataset` roots of a patch-set `pipeline` create), checked against live code
at HEAD 715df1e9876a8420ddea233fba718f20a59fa8e5 plus the staged un-archive.

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/datasource-undo-later-work/HEL-1796`.
- Owner ruling and the fold-in AC are in ticket.md. proposal.md, tasks.md groups 6-7, design.md D9 and the spec delta
  (ADDED only) are consistent with each other. The first requirement is merged at
  `openspec/specs/patch-set-undo/spec.md:321`.
- Phase-1 wiring: `PatchSetUndoBoundPanels.guards` and `PatchSetUndoLaterChildren.guards` both include `pipeline`
  create (BoundPanels.scala:26-27, LaterChildren.scala:22). So `guarded` does not return early for it, and either the
  `checkOne` `("pipeline","update"|"create")` arm or `guarded`'s for-block is live code. The location D9 gives works.
- Exclusion by pipeline id: `DataSourceReferenceRepository.find` groups hits per pipeline
  (`VisiblePipelineRef(id, name, ownerId, tag, references: Vector[String])`, with root/join/lookup/union/upsertTarget
  kinds), so dropping the undone pipeline's id also drops its own steps' secondaries and upsert target. The applier
  owns that pipeline, so it is always in `pipelines` and never in `hiddenPipelineCount`.
- Phase-2 placement: `restorePipelineCreateUndo` (PatchSetUndoService.scala:214) deletes the pipeline first and then
  runs `PatchSetUndoInlineSources.cleanup`. A re-check before the pipeline delete is the only point at which nothing
  has been deleted yet, so the placement is right.
- Journal back-compat: `JournaledInlineSource` is `jsonFormat2` today (PatchSetApplicationRepository.scala:161-164),
  and `journaledCreatedDatasetFormat` is declared earlier in the file (line ~148). With jsonFormat3, spray reads a
  missing `Option` field as `None` and ignores unknown fields, so old rows read and a rolling deploy is safe.
- Stamp source: inline dataset roots go through `DataSourceService.createStatic` (PipelineRootWrites.scala:73), which
  is the same single-`Instant` stamping D2 relies on. So `T` is as sound here as in the dataSource arm.
- Ruling coverage: appended rows, apply-era row edits and schema edits map onto D3's appended, edited and
  schemaEdited. 409, nothing changed and counts only come from the Phase-1 placement and the D7 wording.
- `datasetLaterWork` (DataSourceRepository.scala:306-313) has **no source-kind filter**. It returns `Some` with
  `sourceUpdatedAt` for any `data_sources` row. `SourceService.refreshRest`/`refreshSql` bump `updated_at` through
  `upsertInferredSchema` (SourceService.scala:~436/451). This is the basis for CR1.

### Verdict: REFUTE

### Change Requests
1. **D9 must limit the check to inline roots whose live source is `dataset` kind, and say so.** D9 journals
   `createdDataset` "only for dataset-kind inline roots". It also says "A missing value uses the D4 `appliedAt`
   fallback", and Phase 1 runs "for each journaled inline source that still exists". Read literally, every `rest_api`
   or `sql` inline root (where `createdDataset` is always `None`), and every inline root in a pre-fold-in journal,
   goes through the D4 fallback. Its `changed = data_sources.updated_at > appliedAt` fires after any refresh, because
   `datasetLaterWork` does not filter on kind. That would refuse whole undos the ruling never covered. It would also
   break the merged scenario "Implicit Connector of a bare-url REST inline root is removed with its source"
   (spec.md:186-188) whenever the source has been refreshed since the apply. Required: in both phases, check the live
   `source_type`, either by filtering `datasetLaterWork` to `dataset` or by reading the kind first. A non-dataset inline
   root must never block. State this in D9 and in task 6.3.
2. **The D9 Phase-2 re-check must apply the same referenced-skip as Phase 1, not only the D3/D4 predicate.** D9 says
   "the same predicate re-checks in `restorePipelineCreateUndo`". D1 and D9 both use "the predicate" for the D3/D4
   detection alone. If the referenced-skip is left out, the scenario "A still-referenced inline source keeps HEL-1493
   behaviour" goes wrong: the source has appended rows, Phase 1 skips it, and Phase 2 then finds the rows and fails
   the edit. The spec says the undo must succeed. Required: say explicitly that Phase 2 recomputes `findReferences`
   minus the undone pipeline's id. If anything remains, it does not block, and cleanup keeps the source. Only an
   unreferenced source is judged by D3/D4.
3. **Define "any reference remains" to include the hidden counts.** It should read `pipelines` (minus the undone
   pipeline) nonEmpty, or `panels` nonEmpty, or `hiddenPipelineCount > 0`, or `hiddenPanelCount > 0`. The source is
   kept in exactly that case: `DataSourceService.delete` refuses on hidden referencers too (`inUseReason` counts
   them). If a reference the user cannot see is ignored, the undo is refused for a source that option B would have
   kept.
4. **Extend task 6.1/7.1 coverage to match items 1-3.** Add these tests:
   - (a) a `rest_api` or other non-dataset inline root whose `updated_at` moved after the apply still undoes, and is
     removed;
   - (b) an old journal (`inlineSources` entries without `createdDataset`) on a dataset inline root, with an append
     after the apply, refuses through the D4 fallback;
   - (c) the Phase-2 re-check through the deterministic hook, both for an unreferenced source (the edit fails with
     counts only, and the pipeline and source survive) and for a referenced source with later rows (the undo still
     succeeds, and the source is kept);
   - (d) a reference by the undone pipeline's own join or lookup step secondary does not count as referenced.

   Add the mutations "drop the kind filter" and "drop the Phase-2 reference skip", each of which must go red.

### Non-blocking notes
- D9 says the arm runs "in `checkOne` beside the HEL-1795/1720 checks". Those checks live in `guarded`, not
  `checkOne`. Both places are live for `pipeline` create, so the wording is harmless, but name one place.
- `PatchSetUndoDatasetLaterWork.blocking` takes a `JournaledEdit` and reads `edit.newId` and `edit.createdDataset`. The
  inline arm needs a `(sourceId, Option[JournaledCreatedDataset])` overload. That is a small refactor of shipped code,
  so keep the dataSource arm's behaviour byte-identical.
- `journaledInlineSources` is synchronous today. The inline read-back (`readCreatedDatasetStamp`) is async, so it
  needs an accumulator like `createdDatasets`. It must stay non-failing, as D9 requires.
- On old journals the D4 fallback also refuses after a rename of a dataset inline root. That is the same accepted
  over-refusal as D4, but say so in D9, since a rename never blocked a pipeline-create undo before.
- The merged scenario "Unreferenced inline root source is removed on undo" now holds only when there is no later
  work. Adding a separate refusal requirement follows the HEL-1720/1795 precedent, which is acceptable.
