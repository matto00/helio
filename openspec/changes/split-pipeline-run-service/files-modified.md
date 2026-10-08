- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — entry point (1770 -> 634 lines): ctor/doc/companion/`CachedRunStatus`/`TriggerSource`, both `ServiceError.Forbidden(` producers (submit, previewAtNode), previews, existence checks kept verbatim; collaborators wired after `backend`; four one-line delegations
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunSupport.scala` — new (124): shared helpers (failure logging/translation, truncation fields/JSON, root DataSource resolution)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunTerminalWrites.scala` — new (217): `publish`, `publishTerminalAfter` (HEL-1366), and the failed / dry_run / write-back-failed / blocked terminal paths
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunSucceededWrites.scala` — new (310): unblocked-success materialization chain; its `succeeded` publish goes through `PipelineRunTerminalWrites.publishTerminalAfter` (design D2a)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunExecutor.scala` — new (330): `runPipeline`, `executeRun` (HEL-1370 / HEL-1374 sites), success dispatch, write-back apply
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunBackfill.scala` — new (172): Output node backfill
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunQueries.scala` — new (189): latest run, run status, history reads
- `backend/src/main/scala/com/helio/services/pipelines/README.md` — "Holds" line names the entry point and its `private[pipelines]` collaborators
- `openspec/changes/split-pipeline-run-service/{move-evidence.md,api-evidence.md,test-count-evidence.md,move-check/}` — evidence (checker, spec, javap script)

## Follow-up candidates (found while moving; NOT fixed here, refactor discipline)
1. Entry point is still 634 lines (previews must stay with the pinned `Forbidden` producer, C2). Moving previews out needs an `ExistenceNotLeakedRoutesSpec` pin edit.
2. `PipelineRunSupport.resolvePrimaryDataSourceInternal` has no caller (dead private since HEL-913's N-root work).
3. The entry point's `private val log = LoggerFactory.getLogger(getClass)` is now unreferenced (kept verbatim per D1).
4. Stale doc references after the move: `truncatedReadsToJson`'s `[[PipelineRunService.parseTruncationRecord]]` (member now in `PipelineRunQueries`); `recordUnrunnable`'s `[[runPipeline]]` and "`onBlockedRun`'s persistence pattern below" (members now in other files); other comments saying "this file"/"this class"/"sibling" about moved members.
5. `backfillOutputNode`'s inline signature comment says `explicitRootId` is "Defaulted to `None`" but the parameter has no default (callers pass it explicitly); the unchanged signature is preserved.
6. Odd indentation inside `executeRunFailure` (8-space body) and `previewAtNode` (`case _ =>` arm body under-indented) moved verbatim.
7. `PipelineRunTerminalWrites` imports named members of `PipelineRunSupport` via `import support.{...}`; if a future rename touches those, the imports are the only coupling to update.
8. HEL-1313 / HEL-1283 worktrees were not inspected or touched; whether either edits `PipelineRunService.scala` is unverified from here.
