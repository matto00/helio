## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD: b14e622ee325c32569a452b6d9a8eb1d826ca76b. The change dir is untracked and there are no code changes yet. I re-checked the whole design against the code, not only the round-1 diffs.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/pipeline-run-terminal-sse-gaps/HEL-1370`.
- **Premise (both paths), re-read in `PipelineRunService.scala`:**
  - Path 1: `executeRun` publishes `queued` at line 1030 with no condition. That is before `rateLimitCheck` (1037-1043) and before `preExec`'s `insertRunIfUnderConcurrencyCap`. Both `Left(TooManyRequests)` branches return with no further publish, and a failed guard Future also publishes nothing further.
  - Path 2: `onRunSuccess` (1277-1310) is `applyPendingWriteBacks(...).flatMap { Left => onWriteBackFailure; Right => onUnblockedRunSuccess }`. `DataSourceRepository.applyWriteBacks` only does `.recover { case e: IllegalStateException => Left(...) }`, so any other DB error is a failed Future that skips both branches. In that case no terminal event is published and no terminal row write happens.
  - `grep '"queued"'` across `backend/src/main/scala` finds one publish site (line 1030). `executeRun` has a single caller (line 378), so no second `queued` path is missed.
- **CR1 resolved (pipeline-run-execution delta):** I extracted the live requirement "Non-dry run persists a pipeline_runs record" from `openspec/specs/pipeline-run-execution/spec.md` (it appears exactly once) and diffed it against the delta. The only differences are the intended ones:
  - (a) "`queued` when pre-execution begins" became "`queued` once the run is admitted by the pipeline-run guard", plus the guard-rejected and write-back sentences.
  - (b) The WHEN of scenario "SSE queued event published before engine starts" was reworded to "admitted by the pipeline-run guard".
  - (c) Two scenarios were added: guard-rejected publishes nothing, and write-back exception persists `failed`.

  Every other line of the requirement body and every other scenario is byte-identical. The cross-reference `pipeline-run-guard` exists in `openspec/specs/`, and its spec says nothing about `queued` or SSE, so nothing conflicts. Task 1.4 covers keeping this delta in sync.
- **pipeline-run-sse delta, re-diffed against the live requirement:** all original scenarios are preserved. The only changes are the intended rewording and the two added scenarios, plus one trailing blank line, which is immaterial.
- **`openspec validate pipeline-run-terminal-sse-gaps --strict`** returned "Change 'pipeline-run-terminal-sse-gaps' is valid".
- **CR2 resolved (rate-limit test):** D3 and task 2.2 now say `rateLimitPerWindow = 0` with no priming run. `PipelineRunGuardRepository.incrementRateIfUnderLimit` returns `Left` before any DB work when `limit < 1` (line 50), and the constructor accepts `pipelineRunGuardRepo` (line 98) and `guardConfig` (line 106). The harness opens `Subscriber` at construction (spec line 267), so on b14e622ee the rejected submit's `queued` reaches a live subscriber. The case is genuinely red.
- **D1 soundness, re-derived:** moving `queued` into `preExec.flatMap`'s `Right(())` branch puts it after the cap insert committed the `queued` row. The only step in between is `deleteOldRuns`, which is already `recoverWith`'d. Dry runs reach the same point after the rate limit passes. The event order `queued → running → …` is unchanged.
- **D2 soundness:**
  - The `transformWith(_ => Future.failed(ex))` shape always re-fails with the original exception, so every `submit` caller sees exactly what it sees today. I confirmed the full caller list by grep: `PipelineRunSubmitRoutes:28`, `PipelineSchedulerService:152/230`, `PipelineProposalService:525`, `HookTriggerService:74`.
  - Because the recovery wraps only `applyPendingWriteBacks`, the re-failed Future skips the downstream `flatMap`. `onWriteBackFailure` (1335-1358) therefore publishes exactly once through `publishTerminalAfter`, even if its own writes fail.
  - The generic `errMsg` keeps the `Step (upsertsource):` prefix used by the `Left` branch, which satisfies the spec's "names upsertsource without exposing the raw exception".
- **D3 feasibility:**
  - The harness wraps the real `InProcessExecutionBackend` in `GatingBackend`, so a seeded `upsertsource` step really populates `writeBackSink`.
  - A PL/pgSQL `RAISE` on the target dataset's row write arrives as a `PSQLException`, not an `IllegalStateException`, so the case is red: today no terminal event is published and `awaitTerminal` times out.
  - The row-lock ordering from `startAndLockRunRow`/`finishFailedCase` carries over, because `applyWriteBacks` never touches `pipeline_runs`.
  - Concurrency-cap case: B's `queued` (a different runId) is published today before the cap check. That makes "every event carries A's runId" red.
- **AC coverage:**
  - AC1 is covered by the premise-validation evidence.
  - AC2 by D1, task 1.1 and tests 2.2/2.3.
  - AC3 by D2, task 1.3 and test 2.4.
  - AC4 by C2 and the red-first tests.
  - The driver constraint (minimal diff) is C1, and the out-of-scope section is present.
- **Placeholders:** the change dir has no TODO, TBD or deferred decisions.

### Verdict: CONFIRM

### Non-blocking notes

- `proposal.md` → "Modified Capabilities" lists only `pipeline-run-sse`, but the change now also carries a `pipeline-run-execution` delta. Add it to the list for consistency. Strict validation passes either way.
- D3 rate-limit non-vacuity says "an event published afterwards on the same pipeline still reaches it". With the limit at 0, no service submit can be admitted, so that event has to come from a direct `registry.publish` (or the bus). The implementer should do it that way and not try a second submit.
- D2 needs `scala.util.control.NonFatal` imported. `PipelineRunService.scala` does not import it today.
- `workflow-state.md` has `TICKET_TYPE: feature`, but this is a bug fix. The final gate should still expect the systematic-debugging evidence: the code-confirmed root cause and red-first regression tests, which C2 already requires.
