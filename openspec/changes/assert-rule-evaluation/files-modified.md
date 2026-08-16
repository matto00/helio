## Files modified

- `backend/src/main/scala/com/helio/domain/AssertionResult.scala` — new: `AssertionResult` (one
  per rule, aggregated across the row set) and `AssertionSink` (caller-supplied, `synchronized`-guarded
  mutable accumulator threaded through the engine — design.md Decisions 1/2/4).
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — `PipelineExecutionContext` gains an
  `assertionSink: AssertionSink = new AssertionSink` field (default keeps every existing direct
  construction site unaffected).
- `backend/src/main/scala/com/helio/domain/steps/AssertStep.scala` — implements
  `AssertStep.evaluateRules` (per-kind evaluation for `notNull`/`unique`/`range`/`rowCountMin`/
  `rowCountMax`/`regex`, never throws on a malformed rule) and wires `AssertStep.evaluate` to call it
  and record results into `ctx.assertionSink`, still returning `rows` unchanged.
- `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala` — `executeWithStepCounts`
  gains an optional 4th parameter `assertionSink: AssertionSink = new AssertionSink`, threaded into
  `makeContext`; `execute`'s delegation and `previewStep`'s call site are unaffected.
- `backend/src/main/resources/db/migration/V84__pipeline_run_assertions.sql` — new migration: creates
  `pipeline_run_assertions` (FK `run_id → pipeline_runs(id) ON DELETE CASCADE`, index on `run_id`) with
  RLS mirroring `pipeline_runs`' own indirect-owner policy one level deeper (re-checked highest existing
  migration was V83 immediately before writing, per design.md Decision 7).
- `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala` — adds
  `PipelineRunAssertionRow`/`PipelineRunAssertionTable`, `insertAssertions` (system-context, no-op for
  empty results), `listAssertionsByRun` (owner-scoped, JOIN through `pipeline_runs` to
  `pipelines.owner_id`), `listAssertionsByRunInternal` (system-context).
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — `executeRun` constructs an
  `AssertionSink` before calling the engine and threads it through; a new `persistAssertions` helper
  (best-effort, `.recoverWith`-guarded, skips when empty) is called from the `Failure` branch (nested
  inside the existing `if (!isDry)` guard), `onDryRunSuccess` (sequenced after its own `insertDryRun`
  completes), and `onRunSuccess` (added to its existing for-comprehension).
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — adds
  `pipeline_run_assertions` to the `rlsTables` allowlist (CONTRIBUTING.md's "adding a new ACL'd table"
  checklist).
- `backend/src/test/scala/com/helio/domain/steps/AssertStepSpec.scala` — extends with
  `AssertStep.evaluateRules` coverage: all six rule kinds' pass/fail scenarios (mirroring spec.md), the
  malformed-rule/unknown-kind/invalid-severity never-throws cases, and `AssertStep.evaluate`'s
  `assertionSink.record` wiring.
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — adds an `AssertConfig`
  case to `makeStep`'s dispatch and three tests: a caller-supplied `AssertionSink` is populated, the
  default (no-sink) call site is unaffected, and `execute()`'s `.map(_._1)` delegation still works.
- `backend/src/test/scala/com/helio/infrastructure/PipelineRunRepositorySpec.scala` — adds
  `insertAssertions`/`listAssertionsByRun`/`listAssertionsByRunInternal` round-trip and
  owner-vs-non-owner (CS2-parity) coverage.
- `backend/src/test/scala/com/helio/services/PipelineRunServiceSpec.scala` — new: real-Postgres
  service-layer spec covering successful real run, failed real run (partial results persist), successful
  dry run, failed dry run (no `insertAssertions` attempt / no FK violation), and editor-grantee-triggered
  real + dry runs (resolve normally despite the existing `insertRun`/`insertDryRun` silent no-op).
