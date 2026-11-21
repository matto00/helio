## Skeptic Report — design gate (fold-in round 2, skeptic-design-7.md)

Scope: the revised D9 scope (design.md D9, tasks.md groups 6-7, specs/patch-set-undo/spec.md, ticket.md), checked
against live code at HEAD 715df1e9876a8420ddea233fba718f20a59fa8e5 plus the staged un-archive.

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/datasource-undo-later-work/HEL-1796`.
- **CR1 (kind filter): addressed.** D9's "Which sources are judged" bullet says the check covers only journaled
  inline sources whose LIVE `source_type` is `dataset`, and that a non-dataset root never blocks even after a refresh.
  Task 6.3 says "live kind = dataset only", and 7.1 adds the "drop kind filter" mutation. This is needed:
  `DataSourceRepository.datasetLaterWork` (DataSourceRepository.scala:306-313) still has no kind filter, so the
  implementer has to add the kind read. The design says so. Live code: `PipelineRootWrites.resolveInlineRootSourceId`
  creates `sql`/`rest_api` inline roots through `SourceService`, and only the dataset/static kind goes through
  `createStatic`. So the dataset-only scope is real, and it is the same single-`Instant` path D2 relies on
  (DataSourceService createStatic, `val now = Instant.now()` stamps both `createdAt` and `updatedAt`).
- **CR2 (Phase-2 referenced-skip): addressed.** D9 Phase 2 runs "the same shared function, references included" in
  `restorePipelineCreateUndo` before the pipeline delete, and says "A referenced source never fails it". Task 6.4 says
  the same and requires hook tests for both the unreferenced and the referenced case. 7.1 adds the "drop Phase-2 ref
  skip" mutation. Placement checked against `PatchSetUndoService.scala:214-226`: `restoreCreateUndo` deletes the
  pipeline first, then `PatchSetUndoInlineSources.cleanup`. So the only point at which nothing has been deleted is
  before `restoreCreateUndo`, and that is where D9 puts the re-check.
- **CR3 (hidden counts): addressed.** D9 defines "referenced" as visible `pipelines`, `panels`,
  `hiddenPipelineCount > 0` or `hiddenPanelCount > 0`, after dropping the undone pipeline's entry. That matches
  `SourceReferences.isEmpty` (DataSourceReferenceRepository.scala:157), which `DataSourceService.delete` uses through
  `referenceConflict` (DataSourceService.scala:~717-733). It also matches what `InlineSourceCleanup.deleteIfUnreferenced`
  turns into `KeptReferenced`. Hits are grouped per pipeline id in `assemble` (DataSourceReferenceRepository.scala:~118-131).
  The applier owns the undone pipeline, so it is always in the visible `pipelines` and can be dropped by id.
- **CR4 (tests): addressed.** 6.1 covers append, row edit, schema edit, referenced-kept (visible and hidden) and the
  clean undo. 6.1b covers (a) a non-dataset root with a moved `updated_at`, (b) an old-journal append through the
  fallback, and (d) the undone pipeline's own join/lookup reference not counting. 6.4 covers (c), the hook tests for
  the unreferenced and the referenced case. 7.1 lists the mutations: drop the inline check, drop the Phase-1 ref skip,
  drop the Phase-2 ref skip, drop the kind filter, and flip a comparison.
- Round-1 non-blocking notes also folded in. Phase 1 now names `guarded` only, which is live for `pipeline` create:
  `guarded` returns early only when `!PatchSetUndoBoundPanels.guards(edit)` (PatchSetUndoConflictCheck.scala:~50-56).
  The predicate refactor to `(sourceId, Option[JournaledCreatedDataset], appliedAt)` keeps the dataSource arm
  byte-identical. The async accumulator is specified. The old-journal rename over-refusal is disclosed.
- Shared predicate: `PatchSetUndoDatasetLaterWork.blocking` computes
  `schemaEdited = declared.isDefined && live != declared`. Inline dataset roots go through `createStatic`, which
  writes `dataset_schema` (DataSourceService.scala:~187, HEL-1074 comment), so `declaredSchema` will be present on the
  journaled path. The schema-edit AC is therefore detectable.
- Ruling coverage: appended rows, apply-era row edits and schema edits refuse the whole undo with a 409, change
  nothing and give counts only. Option B is kept for the referenced case. All four spec scenarios map onto these, and
  the scope matches the fold-in AC. The spec delta is ADDED only.
- No placeholders, TBDs or contradictions between D9, tasks 6-7 and the spec delta.

### Verdict: CONFIRM

### Non-blocking notes
- The accumulator in the apply journaling is keyed per source, not per edit index. `createdDatasets` today is
  `ConcurrentHashMap[Int, JournaledCreatedDataset]` keyed by `edit.index` (PatchSetApplyService.scala:135), but one
  pipeline create can make several inline dataset roots. The inline accumulator therefore needs a per-source key, or
  it has to be filled into each `JournaledInlineSource` directly. Make sure a two-root create is covered by at least
  one test (for example, the append goes to the second root).
- 6.1 does not say that the inline refusal message must carry no id (pipeline, source or row). D8 asserts this for
  the dataSource arm. Add the same assertion to the inline append case. It is cheap, and the source name is the only
  identity allowed.
- No mutation is listed for "drop the hidden-count term from referenced". The hidden referenced-kept test in 6.1
  should go red under it, so state that it does when recording 7.1.
- The spec scenario "A still-referenced inline source keeps HEL-1493 behaviour" uses another pipeline only. A form
  panel bound to the inline source is a reference too. Any extra test for it is optional.
