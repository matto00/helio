- `backend/src/main/scala/com/helio/services/pipelines/LegacyOutputConfigKeys.scala` — new pure Scala mirror of V117's repair mapping (single Scala statement of it)
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoService.scala` — restoreBoundOutputs normalises the journaled Output config before insertInternal
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — update normalises the MERGED config under RestorePriorStored only
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoDeadOutputKeysSpec.scala` — C1 red test (real pipelineStep-delete apply over dead-key Outputs, undo, stored-config asserts) + OutputService.update RestorePriorStored/ValidateWrite tests
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceFixture.scala` — expose accessChecker as a protected var so specs can build an OutputService
- `backend/src/test/scala/com/helio/services/pipelines/LegacyOutputConfigKeysSpec.scala` — normaliser unit tests
- `backend/src/test/scala/com/helio/services/pipelines/LegacyOutputConfigKeysParitySpec.scala` — runs V117's real DO block (temp tables, one connection) over a ~2900-row corpus and pins parity with the Scala mapping
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetApplyServiceSpec.scala` — HEL-1313 rollback test now expects the chart-inapplicable `metricLabel` dropped on RestorePriorStored (option (a))

## D1 enumeration of captured-Output-config write sites (services/)
- `PatchSetUndoService.restoreBoundOutputs` (insertInternal, journaled config) — routed through the normaliser.
- `OutputService.update` via `PatchSetApplyRollback` OutputUpdate (RestorePriorStored) — routed (merged config).
- `PatchSetApplyRollback.compensatePipelineStepDelete` — recreates only the step; bound Outputs cascade-deleted are NOT recreated there, so no captured Output config is written.
- `OutputService.create` (insertInternal) and `PipelineService` create path (insertInternalAction) — write caller-request configs validated by ValidateWrite, never captured journal state.
- `PatchSetApplyForward` OutputUpdate — forward user edit under ValidateWrite, not a restore.
