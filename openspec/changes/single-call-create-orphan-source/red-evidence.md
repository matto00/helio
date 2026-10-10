# Red evidence (HEL-1469) -- measured on the unmodified pre-fix main code (HEAD 625e1deff + the three new spec files only)

Command: sbt -J-Xmx3g testOnly <three specs>. Row counts are `SELECT count(*) FROM data_sources WHERE owner_id = <exact test owner uuid>` before/after.

```
95:[info] PipelineCreateOrphanSourceRoutesSpec:
267:[info] - should leave no data source when a step config is refused (422) *** FAILED ***
268:[info]   1 was not equal to 0 (PipelineCreateOrphanSourceRoutesSpec.scala:117)
269:[info] - should leave no data source when a step type is unknown (400) *** FAILED ***
270:[info]   2 was not equal to 1 (PipelineCreateOrphanSourceRoutesSpec.scala:117)
271:[info] - should leave no data source when an Output config carries a disallowed key (400) *** FAILED ***
272:[info]   3 was not equal to 2 (PipelineCreateOrphanSourceRoutesSpec.scala:117)
273:[info] - should leave no data source when an Output fieldMapping names a column the inline source lacks (400, schema-dependent) *** FAILED ***
274:[info]   4 was not equal to 3 (PipelineCreateOrphanSourceRoutesSpec.scala:117)
275:[info] - should leave no inline source of root 0 when root 1 names an unknown sourceId, simple path (404) *** FAILED ***
276:[info]   5 was not equal to 4 (PipelineCreateOrphanSourceRoutesSpec.scala:117)
277:[info] - should leave no inline source of root 0 when root 1 names an unknown sourceId, transactional path (404) *** FAILED ***
278:[info]   6 was not equal to 5 (PipelineCreateOrphanSourceRoutesSpec.scala:117)
279:[info] - should keep today's 422 and message for a lane reference absent from the request, and leave no data source *** FAILED ***
280:[info]   7 was not equal to 6 (PipelineCreateOrphanSourceRoutesSpec.scala:117)
281:[info] - should keep today's 400 and message for a lane self-reference, and leave no data source *** FAILED ***
282:[info]   8 was not equal to 7 (PipelineCreateOrphanSourceRoutesSpec.scala:117)
283:[info] - should still create the pipeline AND its inline source when the request is valid
291:[info] PatchSetPipelineCreateOrphanSourceSpec:
459:[info] - should be refused on apply at resolve time (400, edit-prefixed) for an unknown step type, leaving no data source *** FAILED ***
460:[info]   expected 400, got Right(PatchSetApplyResponse(Vector(),Some(Invalid step type 'nosuchkind'. Allowed values: aggregate, analyzewithai, assert, cast, chunkbytokencount, compute, convertformat, datebucket, dedupe, extractheadings, fillnull, filter, generatetext, groupby, join, limit, lookup, pivot, rename, select, sort
461:[info] - should be refused on apply at resolve time (400) for a disallowed Output config key, leaving no data source *** FAILED ***
462:[info]   expected 400, got Right(PatchSetApplyResponse(Vector(),Some(Unknown config key for a table Output: `notAKey`. Valid keys: columnFilters, columnFormats, columnOrder, columnSort, compare, fieldMapping, historyPayloads, pinnedColumns),None)) (PatchSetPipelineCreateOrphanSourceSpec.scala:153)
463:[info] - should be refused on PREVIEW (4xx, edit-prefixed) instead of projecting, for an unknown step type and a bad Output config *** FAILED ***
464:[info]   expected 400, got Right(PatchSetPreviewResponse(Vector(EditPreview(0,pipeline,create,None,Some({"createdAt":"2026-10-10T09:13:34.344990196Z","id":"(pending)","name":"OrphanPreviewType","ownerId":"d8f31079-fafa-4b36-9181-21a5c7e85a8d","roots":[{"dataSourceId":"(pending)","dataSourceName":"inline-adca1ae6-8ca0-4fbb-af
465:[info] - should remove the pipeline AND its inline source when a LATER edit in the same apply fails (mid-set rollback) *** FAILED ***
466:[info]   3 was not equal to 2 (PatchSetPipelineCreateOrphanSourceSpec.scala:182)
467:[info] - should still apply a valid inline-root create, keeping its source
505:[info] PipelineCreateInlineSourceCleanupSpec:
677:[info] - should delete the inline source and re-raise the ORIGINAL exception when a transactional-path post-creation call fails *** FAILED ***
678:[info]   Expected exception java.lang.IllegalStateException to be thrown, but no exception was thrown (PipelineCreateInlineSourceCleanupSpec.scala:121)
679:[info] - should delete the inline source and re-raise the ORIGINAL exception when the simple path's pipelineRepo.create fails *** FAILED ***
680:[info]   3 was not equal to 2 (PipelineCreateInlineSourceCleanupSpec.scala:134)
681:[info] - should return the ORIGINAL error when the compensating delete itself fails (guard)
688:[info] [hel1468-guard] ScalaTest summary: failed=14 aborted=0 unreadable=0
692:[info] Tests: succeeded 3, failed 14, canceled 0, ignored 0, pending 0
693:[info] *** 14 TESTS FAILED ***

--- PipelineCreateInlineSourceCleanupSpec after switching the fixture to a join step (union never reaches findByIdInternal):
211:[info] - should delete the inline source and re-raise the ORIGINAL exception when a transactional-path post-creation call fails *** FAILED ***
212:[info]   2 was not equal to 1 (PipelineCreateInlineSourceCleanupSpec.scala:124)
213:[info] - should delete the inline source and re-raise the ORIGINAL exception when the simple path's pipelineRepo.create fails *** FAILED ***
214:[info]   3 was not equal to 2 (PipelineCreateInlineSourceCleanupSpec.scala:134)
226:[info] Tests: succeeded 1, failed 2, canceled 0, ignored 0, pending 0
227:[info] *** 2 TESTS FAILED ***
```

Notes: status/message assertions pass pre-fix (they pin current behavior); the failures are the row-count equality (leaked inline source), and for patch-set apply/preview the status itself (200 with failure / 200 projection instead of 4xx). The 'compensating delete itself fails' case is a GUARD (passes pre-fix by construction) and is labelled so in the spec.

## Post-fix (same three specs, `sbt testOnly`): `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 17, failed 0`.

## Guard failability (task 2.3)
With the `.recover { ... }` in `PipelineService.deleteInlineSources` temporarily removed, the guard `return the ORIGINAL error when the compensating delete itself fails (guard)` FAILED (`java.lang.IllegalStateException: boom: delete` replaced the original Left). Mutation reverted; guard green again.
