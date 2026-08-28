# Files modified — HEL-859

## Production code

- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — adds
  `StepExecutionException` (id/kind/curated-reason, allowlist derivation via `StepExecutionException.from`);
  wraps every `executeWithStepCounts` step failure in it, catching both a synchronously-thrown config
  error (e.g. `Future.successful(StringOpsStep.apply(...))` evaluates eagerly) and an async `Future.failed`
  — the synchronous case was a real bug caught by the engine-level test suite (see below).
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — adds
  `validateStepConfig(kind, config): Option[String]`, dispatched by kind on the raw config string, called
  before the existing `infer*` dispatch in `analyze`. Implements the Decision 6 in-scope validators
  (stringops/fillnull/window/aggregate/groupby/pivot/union/join), each re-checking the step's own
  `SupportedX` val. Malformed-JSON decode failures inside a validator are swallowed so they fall through to
  the pre-existing `infer*`/`parseConfig` malformed-config handling unchanged.
- `backend/src/main/scala/com/helio/domain/steps/StringOpsStep.scala`,
  `FillNullStep.scala`, `WindowStep.scala`, `PivotStep.scala` — `SupportedX` vals de-privatized (no
  behavior change) so `PipelineAnalyzeService` can read the same source of truth the runtime check uses.
- `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala`, `GroupByStep.scala`,
  `UnionStep.scala`, `JoinStep.scala` — extracted a `SupportedX` val each (previously only a `case` match
  plus a hardcoded duplicate string in the error message); both the runtime check and the error message are
  now driven by the same val (design.md Decision 5 / task 3.4a).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — `run`'s failure branch
  and `previewStep`'s `.recover` now forward a `StepExecutionException`'s curated `getMessage` instead of
  the constant `"Pipeline execution failed"`; any other throwable still gets the constant.

## Tests

- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala` — new
  `StepExecutionException` attribution tests (IllegalArgumentException-allowlisted, non-IAE-leaks-nothing via
  a fake step, no-double-wrap); every pre-existing `intercept[IllegalArgumentException]` against a
  `run(...)`/`execute(...)` call site updated to `intercept[StepExecutionException]` (the exception TYPE
  genuinely changed — `.getMessage` assertions on message content were left unchanged since the curated
  reason is still embedded in `StepExecutionException#getMessage`). `loadRows(...)`-direct call sites were
  deliberately left as `IllegalArgumentException` — `loadRows` is untouched by this ticket.
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — new analyze-time
  validation tests for `stringops.operation` (the ticket's own repro) and `fillnull.strategy`/`constant`
  value-required; updates the pre-existing "window — unrecognized function degrades gracefully" test, whose
  old assertion (`validationError shouldBe None`) was exactly the gap this ticket closes — an unrecognized
  `window.function` is now correctly reported as a `validationError` at analyze time.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` — the three
  `PipelineRunRoutesSpec` exact-match assertions on `"Pipeline execution failed"` (:533/:634/:756 per
  design.md's table) updated to the new step-attributed message (the join-missing-DataSource error IS an
  `IllegalArgumentException`, so per the allowlist it's now forwarded verbatim, including the missing id);
  plus a new run-level test asserting the ticket's own repro (step id, `stringops`, `regexExtract`,
  `extractRegex` all present in one 422 response).

## Root cause / probe (systematic-debugging law)

- **Root cause of a real bug found during implementation:** several step `evaluate` implementations (e.g.
  `StringOpsStep.evaluate = Future.successful(StringOpsStep.apply(rows, config))`) evaluate their body
  eagerly — a config-validation `throw` happens synchronously, before any `Future` is returned — so
  `step.evaluate(...).map(...).recoverWith(...)` never got to attach `.recoverWith` for those failures; the
  raw exception escaped unattributed.
- **Probe:** ran `sbt "testOnly com.helio.domain.engine.InProcessPipelineEngineSpec"` after the initial
  (unguarded) engine wrapping — 8 pre-existing tests failed with
  `Expected exception com.helio.domain.engine.StepExecutionException to be thrown, but
  java.lang.IllegalArgumentException was thrown`, all on stringops/fillnull/window/pivot steps (the
  eager-`Future.successful` step kinds), never on join/union (the two step kinds that are genuinely async).
- **Fix:** wrap the `step.evaluate(currentRows, ctx)` call itself in a `try`/`catch` that converts a
  synchronous throw into `Future.failed(ex)` before `.map`/`.recoverWith` is attached.
- **Re-verification:** same command, fresh run, `175/175` passed.

## Non-obvious scope note

Updating `intercept[IllegalArgumentException]` → `intercept[StepExecutionException]` across
`InProcessPipelineEngineSpec` (28 call sites, of which 9 were reverted back to `IllegalArgumentException`
because they call `engine.loadRows(...)` directly, which this ticket does not touch) was **not** in tasks.md
5.6's literal file list (`PipelineRunRoutesSpec` only) — it is a necessary, unavoidable consequence of
Decision 1/2 introducing a new wrapper exception type around every step-execution failure, not scope creep.
