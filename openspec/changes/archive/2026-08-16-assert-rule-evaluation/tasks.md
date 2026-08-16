## 1. Backend: assertion result + sink types

- [x] 1.1 Create `backend/src/main/scala/com/helio/domain/AssertionResult.scala`:
      `AssertionResult(stepId: String, kind: String, field: Option[String], severity: String, passed:
      Boolean, observed: Option[String], message: Option[String])` and `AssertionSink` (a small mutable
      accumulator with `record(results: Seq[AssertionResult]): Unit` and `results: Vector[AssertionResult]`,
      guarded against concurrent access per design.md Decision 4).
- [x] 1.2 `domain/PipelineStep.scala`: add `assertionSink: AssertionSink` to `PipelineExecutionContext`.

## 2. Backend: rule evaluation

- [x] 2.1 `domain/steps/AssertStep.scala`: implement `AssertStep.evaluateRules(rows: Seq[Row], rules:
      Vector[AssertRule]): Vector[AssertionResult]` — per-kind semantics per design.md Decision 3
      (`notNull`, `unique` excluding nulls, `range` with numeric coercion, `rowCountMin`/`rowCountMax`
      dataset-level, `regex`), never throwing on a malformed rule (produces a failed result with an
      explanatory `message` instead).
- [x] 2.2 Wire `AssertStep.evaluate` to call `evaluateRules` then `ctx.assertionSink.record(...)`,
      still returning `rows` unchanged — row-in/row-out contract intact.

## 3. Backend: engine wiring

- [x] 3.1 `domain/InProcessPipelineEngine.scala`: add the optional `assertionSink: AssertionSink = new
      AssertionSink` parameter to `executeWithStepCounts`, threaded into `makeContext`. Confirm
      `execute`'s own delegation (`.map(_._1)`) and `PipelineRunService.previewStep`'s call site are
      unaffected (default parameter, no signature-breaking change for either).

## 4. Backend: migration + persistence

- [x] 4.1 Re-check `backend/src/main/resources/db/migration/` for the current highest `VNN` immediately
      before writing the file (design.md Decision 7 — do not trust a number from planning). (Re-checked:
      highest existing was V83; used V84 — the ticket/design.md's "main at V59" note was stale, as
      Decision 7 warned it might be.)
- [x] 4.2 Add `V<NN>__pipeline_run_assertions.sql`: `CREATE TABLE pipeline_run_assertions` (id, run_id
      FK → `pipeline_runs(id) ON DELETE CASCADE`, step_id, kind, field, severity, passed, observed,
      message) + an index on `run_id` + RLS (`ENABLE`/`FORCE ROW LEVEL SECURITY` + the indirect-owner
      policy from design.md Decision 6, one level deeper than `pipeline_runs`' own).
- [x] 4.3 `infrastructure/PipelineRunRepository.scala`: add the `PipelineRunAssertionRow`/table
      definition, `insertAssertions(runId, results)` (system-context, mirrors `insertRunInternal`),
      `listAssertionsByRun(runId, user)` (owner-scoped) and `listAssertionsByRunInternal(runId)`
      (system-context, for a future grantee-aware caller).

## 5. Backend: service wiring

- [x] 5.1 `services/PipelineRunService.executeRun`: construct an `AssertionSink` before calling the
      engine, pass it through, and call `pipelineRunRepo.insertAssertions` with `sink.results`:
      - in the `Success` branch of `runFuture.transformWith` — both the real-run path (`onRunSuccess`,
        after `insertRun` already ran during `preExec`) and the dry-run path (`onDryRunSuccess`,
        sequenced *after* its own `insertDryRun` call completes — design.md Decision 5's ordering note);
      - in the `Failure` branch, nested inside the existing `if (!isDry) { ... }` guard
        (`PipelineRunService.scala:295`) — never called for a failed dry run, since no `pipeline_runs`
        row exists yet to attach to (design.md Decision 4's second-round revision).
      Guard every call on `pipelineRunRepo != null` (matching the existing null-guard pattern elsewhere
      in this file) and skip when `sink.results` is empty. **Every one of these call sites is also
      wrapped in `.recoverWith { case _ => Future.successful(()) }`** (design.md Decision 4a, third
      round) — mirrors `insertRun`/`deleteOldRuns` (line 271) and `insertDryRun`/`deleteOldDryRuns`
      (line 334)'s existing best-effort-persistence pattern, so a grantee-triggered run (for which
      `insertRun`/`insertDryRun` already silently no-op today, per `PipelineRunRepositorySpec.scala`'s
      CS2 tests) never turns into an unhandled failed `Future` when `insertAssertions` hits the same
      missing-parent-row FK violation.

## 6. Tests

- [x] 6.1 Backend: `AssertStepEvaluationSpec` (or extend `AssertStepSpec`) covering all six rule kinds'
      pass/fail semantics per the spec delta's scenarios, plus the malformed-rule never-throws case.
- [x] 6.2 Backend: `InProcessPipelineEngineSpec` — confirm `executeWithStepCounts` populates a
      caller-supplied `AssertionSink` and that existing callers with no sink argument are unaffected.
- [x] 6.3 Backend: `PipelineRunRepositorySpec` — `insertAssertions`/`listAssertionsByRun`/
      `listAssertionsByRunInternal` round-trip, RLS owner-vs-non-owner scenarios.
- [x] 6.4 Backend: `PipelineRunServiceSpec` (or equivalent) — assertion results persist on a successful
      run, on a failed run (partial results from a step before the failure), on a successful dry run,
      and — the case the design gate's second round added — a FAILED dry run (assert step succeeds,
      later step fails) does NOT attempt an `insertAssertions` call / does not throw an FK violation,
      since no `pipeline_runs` row exists for a failed dry run. **Fifth case (design gate's third
      round):** an editor grantee (not the pipeline owner) triggers a run — real and dry — on a pipeline
      with an assert step; the run SHALL still resolve normally (same response shape as today, since
      `insertRun`/`insertDryRun` already silently no-op for a non-owner), and the new `insertAssertions`
      call SHALL NOT raise or propagate an FK-violation failure, per the `.recoverWith` guard in 5.1.
- [x] 6.5 Backend: `sbt test` passes (full suite).
