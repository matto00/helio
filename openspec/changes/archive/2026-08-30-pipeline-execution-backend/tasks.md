## 1. ### Backend — trait + in-process impl

- [x] 1.1 Add `PipelineExecutionBackend` trait + `PipelineExecutionOutcome` case class in
      `backend/src/main/scala/com/helio/domain/engine/PipelineExecutionBackend.scala`, per
      design.md Decision 1 (`execute(pipeline, dataSource, steps, dataSourceRepo, assertionSink,
      truncationSink)`, `PipelineExecutionOutcome` using the `PipelineRowJson.Row` alias); verify
      `sbt compile` succeeds.
- [x] 1.2 Add `InProcessExecutionBackend` in the same package, wrapping
      `InProcessPipelineEngine.loadRowsWithStats` + `.executeWithStepCounts` verbatim (no logic
      change; `pipeline` param is accepted but unused by this impl since the in-process engine
      doesn't need it), returning `PipelineExecutionOutcome`; verify `sbt compile` succeeds.

## 2. ### Backend — wire PipelineRunService

- [x] 2.1 Add a `null`-defaulted `executionBackend: PipelineExecutionBackend = null` constructor
      parameter to `PipelineRunService` (appended last, after `isBlocked`), resolved to a private
      `backend` field per design.md Decision 3 (`if (executionBackend != null) executionBackend
      else new InProcessExecutionBackend(engine)`); verify the sole production call site
      (`ApiRoutes.scala:288`) and every test fixture that constructs `PipelineRunService` still
      compile unchanged.
- [x] 2.2 Replace `executeRun`'s direct `engine.loadRowsWithStats(...).flatMap { ...
      engine.executeWithStepCounts(...) }` chain with one call to `backend.execute(pipeline,
      dataSource, steps, dataSourceRepo, assertionSink, truncationSink)`, preserving the exact
      downstream tuple shape consumed by the rest of `executeRun`; verify with `sbt "testOnly
      *PipelineRunServiceSpec*"` unchanged/green.
- [x] 2.3 Replace `previewStep`'s direct engine calls with the same `backend.execute(...)` call,
      passing a **fresh `new AssertionSink`** (design.md Decision 3 — `previewStep` today relies on
      `executeWithStepCounts`'s defaulted sink, which the trait's non-optional parameter no longer
      supplies for free); verify the existing step-preview test suite is unchanged/green.

## 3. ### Backend — Spark second-impl adapter

- [x] 3.1 Add an additive `execute(...)` method to `SparkJobSubmitter` implementing
      `PipelineExecutionBackend`, per design.md Decision 2 — a direct synchronous composition of
      `loadDataFrame`/`applyStep`/`collectRows` (NOT calling `submit`/touching `PipelineRunCache`
      or `pipelineRepo`/`pipelineRunRepo`), returning `stepCounts = Map.empty`, `sourceRowCount =
      df.count()` (pre-step), `primaryStats = SourceReadStats(false, None)` — all documented
      approximations per design.md's Risks/Trade-offs; verify `sbt compile` succeeds, `submit`'s
      own method body is byte-for-byte unchanged (diff check), and `SparkJobSubmitter` remains
      unwired (no new route/`ApiRoutes.scala`/`Main.scala` call site).

## 4. ### Tests

- [x] 4.1 Run the full existing pipeline/run ScalaTest suite (`sbt test` scoped to
      `com.helio.services.pipelines` and `com.helio.domain.engine`) and confirm zero behavioral
      diff — every pre-existing test passes unchanged.
- [x] 4.2 Add one direct unit test exercising `SparkJobSubmitter.execute` against a trivial
      static-source pipeline (construct `SparkJobSubmitter` with a real/fake, non-null
      `pipelineRepo` per the file's other test fixtures — `execute` does not call it, but the
      constructor signature still requires a value), asserting the returned
      `PipelineExecutionOutcome`'s `rows` match the source data and `stepCounts`/`sourceRowCount`/
      `primaryStats` match the documented approximations (per design.md's Risks/Trade-offs —
      evidences "admits a second impl", not merely asserts it).
- [x] 4.3 Add one unit test for `InProcessExecutionBackend.execute` asserting it produces the same
      rows/stepCounts/sourceRowCount/primaryStats as calling
      `engine.loadRowsWithStats`/`executeWithStepCounts` directly on the same inputs (parity
      check).
