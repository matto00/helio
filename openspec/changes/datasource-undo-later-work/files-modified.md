
## Fold-in: inline dataset roots of a pipeline create
- `backend/src/main/scala/com/helio/infrastructure/persistence/patchsets/PatchSetApplicationRepository.scala` — `JournaledInlineSource.createdDataset` (jsonFormat3)
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyService.scala` — per-source read-back of created_at and declared schema while journaling (never fails the apply)
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoDatasetLaterWork.scala` — shared `blockingSource`, `inlineFindings`, `inlineBlockers`, fixed Phase-2 phrase
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoConflictCheck.scala` — Phase-1 wiring in `guarded` for `pipeline` creates
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoService.scala` — Phase-2 re-check before the pipeline delete (`restorePipelineCreateUndo`)
- `backend/src/main/scala/com/helio/services/patchsets/README.md` — document the inline-root guard
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoInlineDatasetLaterWorkSpec.scala` — new red-first spec (helio_app_test)
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoInlineSourceCleanupSpec.scala` — journal assertion now allows the created-dataset record

## Original scope (dataSource create arm, already shipped in the first PR head)
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` — new reads readCreatedDatasetStamp and datasetLaterWork
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoDatasetLaterWorkSpec.scala` — red-first spec on helio_app_test
- `openspec/specs/patch-set-undo/spec.md` — first requirement merged by the first archive
