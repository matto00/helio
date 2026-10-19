# Mutation runs (HEL-1660). Each mutation is applied to the source, the named specs are run, and the source is restored.
- `join-row-check` (backend/src/main/scala/com/helio/domain/steps/JoinStep.scala): RED -- 1 failing: should refuse a 400 x 400 one-key fan-out (160,000 rows) before merging a single pair, nam
- `unpivot-row-check` (backend/src/main/scala/com/helio/domain/steps/UnpivotStep.scala): RED -- 1 failing: should refuse 20,001 rows x 5 value columns (100,005 rows) up front
- `splittext-emit-check` (backend/src/main/scala/com/helio/domain/steps/SplitTextStep.scala): RED -- 1 failing: should refuse a split past 100,000 rows while emitting
- `chunk-emit-check` (backend/src/main/scala/com/helio/domain/steps/ChunkByTokenCountStep.scala): RED -- 1 failing: should refuse chunking past 100,000 rows while emitting
- `headings-emit-check` (backend/src/main/scala/com/helio/domain/steps/ExtractHeadingsStep.scala): RED -- 1 failing: should refuse headings past 100,000 rows while emitting
- `engine-backstop` (backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala): RED -- 1 failing: should refuse a union that stacks 50,000 + 100,000 rows, a kind with no emit-time check of
- `text-cap-per-value` (backend/src/main/scala/com/helio/domain/steps/StringBudget.scala): RED -- 1 failing: should refuse one splittext segment past 1,048,576 characters, the per-value cap that is s
- `text-running-budget` (backend/src/main/scala/com/helio/domain/steps/StringBudget.scala): RED -- 4 failing: should stop a compute that copies a 100,000-character text across a 10,000-row fan-out ins; should stop splittext over the same fan-out inside the node; should stop extractheadings over the same fan-out inside the node; should stop pivot column names (a fresh copy of the pivot value per group) inside the node
- `memory-budget` (backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala): RED -- 3 failing: should refuse a join whose 90,000-row output would hold more cells than the budget, naming; should stay charged after release drops it: R(40) + a(40) + b(40) = 120 is refused by a bu; should stay charged after release, because the write-back sink still holds its input until
- `run-label` (backend/src/main/scala/com/helio/domain/engine/RunLimits.scala): RED -- 13 failing: should refuse a 400 x 400 one-key fan-out (160,000 rows) before merging a single pair, nam; should refuse 20,001 rows x 5 value columns (100,005 rows) up front; should refuse a split past 100,000 rows while emitting; should refuse chunking past 100,000 rows while emitting
- `backend-wiring` (backend/src/main/scala/com/helio/domain/engine/InProcessExecutionBackend.scala): RED -- 13 failing: should refuse a 400 x 400 one-key fan-out (160,000 rows) before merging a single pair, nam; should refuse 20,001 rows x 5 value columns (100,005 rows) up front; should refuse a split past 100,000 rows while emitting; should refuse chunking past 100,000 rows while emitting
- `terminal-retention` (backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala): RED -- 3 failing: should stay in nodeOutcomes, and be the result rows, even when the retain set names only a; should fall back to the lowest root, and keep it, when that root has no trunk steps; should not stay charged when the upsertsource step is disabled (it records no write)
- `root-pinning` (backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala): RED -- 1 failing: should stay charged after release drops it: R(40) + a(40) + b(40) = 120 is refused by a bu
- `writeback-pinning` (backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala): RED -- 1 failing: should stay charged after release, because the write-back sink still holds its input until
- `leaf-first-inferred` (backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala): RED -- 2 failing: should stay structuralRank for a run, which sets a live-cell budget but never leafFirst (r; should finish a leaf before descending when leafFirst is set, with or without a live-cell 
- `d7-try-throwable` (backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala): RED -- 1 failing: should thrown by the first step escape executeTree itself, not become a step error
- `d7-drop-boxed-fatal-passthrough` (backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala): RED -- 1 failing: should returned by the first step as a failed Future fail the walk without a step error
- `d7-drop-soe-arm` (backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala): RED -- 2 failing: should thrown by a step stay a step error naming the step, with the overflow as its cause; should raised by a user regex in a real stringops step stay a step error on the run path
- `d7-drop-soe-exemption` (backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala): RED -- 1 failing: should returned by a step as a failed Future (boxed by Scala) be unwrapped and stay the sa
- `dockerfile-flag` (Dockerfile): RED -- 1 failing: should pass -XX:+ExitOnOutOfMemoryError to the JVM

- `text-cap-expression` (backend/src/main/scala/com/helio/domain/engine/ExpressionInterpreter.scala): RED -- 1 failing: should refuse a concat or a + that would build a text past 1,048,576 characters BEFORE bui
- `guard-budget-below-ac6` (backend/src/main/scala/com/helio/domain/engine/RunLimits.scala): RED -- 1 failing: should hold the AC6 walk (root 300k + retained middle Output 550k + parent 750k + child 80
- `guard-budget-above-ceiling` (backend/src/main/scala/com/helio/domain/engine/RunLimits.scala): RED -- 1 failing: should stay at or under the measured ceiling
- `guard-row-cap` (backend/src/main/scala/com/helio/domain/engine/RunLimits.scala): RED -- 1 failing: should keep the owner-ruled numbers
- `empty-retain-from-executor` (backend/src/main/scala/com/helio/services/pipelines/PipelineRunExecutor.scala): RED -- 2 failing: should succeed under the run budget and write both Outputs' snapshots: 50,000 x 6 CSV, a 1; should write the snapshot of an Output on a non-trunk branch too (its frame is retained by
- `postwalk-limit-unbounded` (backend/src/main/scala/com/helio/domain/engine/RunLimits.scala): RED -- 3 failing: should refuse the skeptic's adjacent-Outputs shape (23-column terminal plus its 22-column ; should hold the post-walk limit at or under the measured ceiling (design.md Measured Budge; should fail cleanly with the run memory-limit error and write no snapshot: 17 concat steps
- `postwalk-check-not-called` (backend/src/main/scala/com/helio/services/pipelines/PipelineRunExecutor.scala): RED -- 1 failing: should fail cleanly with the run memory-limit error and write no snapshot: 17 concat steps
- `postwalk-drop-json-copies` (backend/src/main/scala/com/helio/domain/engine/RunLimits.scala): RED -- 2 failing: should pin the AC6 shape (Outputs on a 16-column terminal and an 11-column middle node) at; should refuse the skeptic's adjacent-Outputs shape (23-column terminal plus its 22-column 


## One-line edits (old -> new) of the cycle-1 mutations
- `join-row-check`: `ctx.maxNodeRows.foreach(max => checkOutputSize(rows, rightIndex, normalizedType, max, ctx.limitLabel))` -> `()`
- `unpivot-row-check`: `rows.size.toLong * valueVars.length > max)` -> `rows.size.toLong * valueVars.length > Int.MaxValue)`
- `splittext-emit-check`: `RowBudget.flatMap(rows, maxRows, Kind, label)` -> `RowBudget.flatMap(rows, None, Kind, label)`
- `chunk-emit-check`: `RowBudget.flatMap(rows, maxRows, Kind, label)` -> `RowBudget.flatMap(rows, None, Kind, label)`
- `headings-emit-check`: `RowBudget.flatMap(rows, maxRows, Kind, label)` -> `RowBudget.flatMap(rows, None, Kind, label)`
- `engine-backstop`: `ctx.maxNodeRows.filter(frame.size > _)` -> `ctx.maxNodeRows.filter(_ => false)`
- `text-cap-expression`: `if (length > maxChars) throw StringBudget.tooLong(maxChars, label)` -> `if (false) throw StringBudget.tooLong(maxChars, label)`
- `text-cap-per-value`: `    if (length > maxChars) throw StringBudget.tooLong(maxChars, label)     usedBytes` -> `    usedBytes`
- `text-running-budget`: `if (usedBytes > limitBytes) throw` -> `if (false) throw`
- `memory-budget`: `if (tally.tryAdd(frame, budget)) None` -> `if (true) None`
- `run-label`: `limitLabel = LimitLabel.Run` -> `limitLabel = LimitLabel.Draft`
- `backend-wiring`: `contextTransform = RunLimits.contextTransform, ` -> `(removed)`
- `terminal-retention`: `val kept0 = if (runRetention) keep + terminalKey else keep` -> `val kept0 = keep`
- `root-pinning`: `var heldElsewhere: Set[NodeKey] = if (runRetention) rootIds.map(rid => RootKey(rid): NodeKey).toSet else Set.empty` -> `var heldElsewhere: Set[NodeKey] = Set.empty`
- `writeback-pinning`: `if (runRetention && next.enabled && next.kind == PipelineStepKind.UpsertSource) heldElsewhere = heldElsewhere + key + parentKey(next)` -> `()`
- `empty-retain-from-executor`: `.execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, retain, onNodeProgress` -> `.execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, Set.empty[NodeKey], onNodeProgress`
- `leaf-first-inferred`: `if (leafFirst)` -> `if (ctx.maxLiveCells.isDefined)`
- `draft-wording`: `LimitLabel("Draft preview", "draft preview", "request")` -> `LimitLabel("Draft preview", "pipeline run", "request")`
- `d7-try-throwable`: `case so: StackOverflowError => Future.failed(StepExecutionException.from(step.id.value, step.kind, so, pathOf(step)))         case NonFatal(ex)           => Future.failed(ex)` -> `case ex: Throwable => Future.failed(ex)`
- `d7-drop-boxed-fatal-passthrough`: `case ex if InProcessPipelineEngine.isBoxedFatal(ex) => Future.failed(ex)` -> `case ex if false => Future.failed(ex)`
- `d7-drop-soe-arm`: `case so: StackOverflowError => Future.failed(StepExecutionException.from(step.id.value, step.kind, so, pathOf(step)))         case NonFatal(ex)` -> `case NonFatal(ex)`
- `d7-drop-soe-exemption`: `cause != null && !NonFatal(cause) && !cause.isInstanceOf[StackOverflowError]` -> `cause != null && !NonFatal(cause)`
- `dockerfile-flag`: `  "-XX:+ExitOnOutOfMemoryError", \ ` -> `(removed)`

## Cycle 2-3 edits
- `guard-budget-below-ac6`: `MaxLiveCells = 2600000L` -> `2300000L`; `guard-budget-above-ceiling`: -> `4000000L`; `guard-row-cap`: `MaxStringChars = 1048576` -> `2097152`
- `postwalk-limit-unbounded`: `MaxPostWalkCells = 3900000L` -> `Long.MaxValue`; `postwalk-check-not-called`: `if (!isDry) refuseOverPostWalkBudget(` -> `if (false) refuseOverPostWalkBudget(`; `postwalk-drop-json-copies`: `held + cost(terminalRows) + others...max` -> `held`
- `snapshot-write-unbatched` (backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala): RED -- 1 failing: should build at most 200 rows' JSON text per batch
- `snapshot-write-unbatched`: `SnapshotInsertBatchSize = 200` -> `100000`
