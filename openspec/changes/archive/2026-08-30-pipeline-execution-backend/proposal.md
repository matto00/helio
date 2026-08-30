## Why

HEL-238 needs a second pipeline execution engine (Dataproc Serverless, HEL-331) to plug in behind
the same run/status/result contract the in-process engine and `SparkJobSubmitter` currently
implement ad hoc and inconsistently. Row 0a of the Pipelines & Outputs remodel (HEL-903) creates
that seam first, before any second implementation exists, so later tickets (HEL-331, HEL-332,
HEL-905) build against a stable interface instead of the concrete engine call sites.

## What Changes

- Introduce a `PipelineExecutionBackend` trait in `com.helio.domain.engine` modeling submit-run
  execution: given a resolved `DataSource` + enabled step list, produce the row/step-count/stats
  outcome the run service already computes today.
- Add `InProcessExecutionBackend`, wrapping the existing `InProcessPipelineEngine.loadRowsWithStats`
  + `executeWithStepCounts` calls verbatim — no change to engine internals.
- `PipelineRunService` depends on the trait (constructor-injected, defaulted to
  `InProcessExecutionBackend`) instead of calling `engine` directly at its two call sites
  (`executeRun`, `previewStep`).
- Adapt `SparkJobSubmitter` to also implement the trait's `execute` signature (thin glue over its
  existing `submit` + `PipelineRunCache` polling), demonstrating the trait admits a second impl —
  it remains unwired (dormant, HEL-202) and unused by any route, unchanged from today.
- No wire, routing, or persisted-behavior change anywhere.

## Capabilities

### New Capabilities
(none — pure structural refactor, no spec-level behavior changes)

### Modified Capabilities
(none)

## Impact

- `backend/src/main/scala/com/helio/domain/engine/` — new `PipelineExecutionBackend.scala`
  (trait + result case class) and `InProcessExecutionBackend.scala`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — depends on the
  trait instead of `InProcessPipelineEngine` directly at the two execution call sites.
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — implements the trait
  alongside its existing `submit` method; no behavior change to its (dormant, unwired) execution.
- No `Main.scala` change — `PipelineRunService` is constructed only at `ApiRoutes.scala:288`, and
  `InProcessExecutionBackend` is wired via an internal `null`-defaulted resolution inside
  `PipelineRunService` itself (design.md Decision 3), so no call site needs editing.
- Existing pipeline/run ScalaTest suites — updated only where they construct `PipelineRunService`
  directly and want to inject a fake backend for isolation; all others pass unchanged.

## Non-goals

- No Dataproc Serverless implementation (HEL-331).
- No tiered dispatch / routing policy (HEL-332).
- No change to the engine tree-walk or node-snapshot model (HEL-905).
- No change to `SparkJobSubmitter`'s own execution logic, wiring, or route exposure.
