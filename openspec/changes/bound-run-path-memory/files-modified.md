# Files modified (HEL-1660)

## Production code
- `Dockerfile` — adds `-XX:+ExitOnOutOfMemoryError` to the JVM flags (owner ruling 7).
- `backend/src/main/scala/com/helio/domain/steps/LimitLabel.scala` — new: the label (sentence / mid-sentence / scope) a limit message takes, `Draft` and `Run`.
- `backend/src/main/scala/com/helio/domain/steps/RowBudget.scala` — `RunMaxNodeRows` (100,000); `exceeded`/`backstop`/`flatMap` take a label (default draft, byte-identical wording).
- `backend/src/main/scala/com/helio/domain/steps/StringBudget.scala` — the budget carries a label; `tooLong`/`exceeded` word by label.
- `backend/src/main/scala/com/helio/domain/steps/{JoinStep,UnpivotStep,SplitTextStep,ExtractHeadingsStep,ChunkByTokenCountStep,ComputeStep}.scala` — pass `ctx.limitLabel` / the budget's label to the guards.
- `backend/src/main/scala/com/helio/domain/engine/{ExpressionInterpreter,ExpressionEvaluator}.scala` — the per-value text guard takes the label (`eval(row, maxChars, label)`).
- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — `PipelineExecutionContext.limitLabel` (default draft).
- `backend/src/main/scala/com/helio/domain/engine/RunLimits.scala` — new: 100,000 rows, 1,048,576 chars, 3,000,000 live cells (measured), the run context transform.
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — `leafFirst` and `runRetention` parameters; terminal retention, root and write-back pinning; run labels in the backstop and memory messages; `evalOneStep` catches `NonFatal` and `StackOverflowError` only, with the boxed-fatal pass-through and the boxed-overflow unwrap.
- `backend/src/main/scala/com/helio/domain/engine/{PipelineExecutionBackend,InProcessExecutionBackend}.scala` — required `retain: Set[NodeKey]`; the backend applies `RunLimits` (the one place every run, the saved preview and backfill pass through).
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — takes the new (unused) `retain` parameter.
- `backend/src/main/scala/com/helio/services/pipelines/OutputNodeKeys.scala` — new: the one Output -> node-key mapping the writes and the retain set share.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunExecutor.scala` — lists the pipeline's Outputs before the walk and passes their node keys as `retain`; takes `outputRepo`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — passes `outputRepo` to the executor.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunSucceededWrites.scala` — alert-skip log is `warn` for an Output created mid-run (outside `retain`), `error` for a real miss; the terminal Output reuses the run's `jsRows` instead of a second JSON copy (measured memory optimisation, design.md "Measured Budget").
- `backend/src/main/scala/com/helio/services/pipelines/{PipelineRunPreview,PipelineRunBackfill}.scala` — pass their `retain` (root key, then the target step key) per `execute` call.
- `backend/src/main/scala/com/helio/services/pipelines/draftpreview/DraftPreviewService.scala` — sets `leafFirst = true` explicitly (was inferred from `maxLiveCells`).

## Tests
- `backend/src/test/scala/com/helio/domain/engine/RunLimitsSpec.scala` — per-kind run limits through `InProcessExecutionBackend.execute`, exact run wording (red on unchanged code: `evidence/red-run-limits-xmx768m.log`).
- `backend/src/test/scala/com/helio/domain/engine/FatalErrorHandlingSpec.scala` — the four D7 cases plus a real regex overflow (red first: `evidence/red-fatal-errors-xmx768m.log`).
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineRunRetentionSpec.scala` — terminal, root and write-back retention.
- `backend/src/test/scala/com/helio/domain/engine/ContainerJvmFlagsSpec.scala` — the Dockerfile flag.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunLimitsServiceSpec.scala` — AC5/AC6 through the service: failed run, no snapshot, saved preview error, the 50,000 x 6 ordinary pipeline writing three Outputs' snapshots.
- `backend/src/test/scala/com/helio/services/pipelines/RunPathHeapSpec.scala` — the end-to-end heap measurement that sizes `MaxLiveCells`.
- `backend/src/test/scala/com/helio/testsupport/{RunBackendFixture,RunServiceHarness}.scala` — new fixtures.
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineDraftSeamSpec.scala` — walk order keyed on the explicit `leafFirst`, plus a run-keeps-structuralRank case.
- `backend/src/test/scala/com/helio/api/routes/pipelines/DraftPreviewHeapSpec.scala`, `backend/src/test/scala/com/helio/testsupport/DraftPreviewBoundFixture.scala` — engine override signatures gain `leafFirst`/`runRetention`.
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala`, `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala`, `backend/src/test/scala/com/helio/services/pipelines/{Hel1503EditorRunGapsSpec,Hel1516GranteeDriftPreviewSpec,LateFinisherSeamIsolationSpec,LiveRunReaperSpec,PipelineRunEditorPersistenceSpec,PipelineRunGuardIntegrationSpec,PipelineRunServiceSpec,PipelineRunServiceTerminalOrderingSpec}.scala` — stub backends and call sites take the required `retain`.

- `backend/src/test/scala/com/helio/services/pipelines/LateFinisherSpecBase.scala` — takes `retain`, and `HookOutputRepo` leaves a pipeline's Output listings alone until the engine has returned for it: the run now lists Outputs once BEFORE the walk (design D3), and the late-finisher seams target the success chain's list.

## Change record
- `openspec/changes/bound-run-path-memory/{design.md,tasks.md,files-modified.md}` and `evidence/` (red-*, green-*, mutation-* logs; `mutations.md` is the index).
