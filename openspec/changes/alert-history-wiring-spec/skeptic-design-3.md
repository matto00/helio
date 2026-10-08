## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD d2601e2581b8a26373456b1b65078c67d5612bf6. The planning artifacts are untracked in the change dir and there is no code diff yet (`git status --short` shows only `?? openspec/changes/alert-history-wiring-spec/`).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/alert-history-wiring-spec/hel-1283`.
- **Round-2 CR1(a), the false "fails loudly" claim, is removed.** D3b now says a timeout "is NOT loud on its own" and names both swallow sites. I checked both in the live tree:
  - AlertEvaluationService.scala:108-118 wraps each rule in `evaluateRule(...).recover { case NonFatal(e) => log.error(...); () }`.
  - PipelineRunService.scala ~1586-1589 has `.recoverWith { case ex => log.error(...); Future.successful(()) }`.
  
  D7 no longer says "fails loudly" either.
- **CR1(b), outcomes are recorded.** D3b says the subclass "MUST record every armed wait's outcome (thread-safe counters or a concurrent list: satisfied / timedOut)". Task 2.3 repeats it.
- **CR1(c), the precondition comes before the alert assertions.** D3b, D7, task 2.4 and standing constraint C2 all require `satisfied >= 1, timedOut = 0` to be asserted before any run-2 alert-event assertion, with counters reset for each armed run.
- **CR1(d), M4 red runs must show the precondition held.** D6 requires that every M4 red transcript shows the precondition held. A red caused by a timeout is explicitly not evidence. Task 3.4 and C2 repeat this.
- **Round-2 non-blocking notes are addressed.**
  - D1 now names `ReadAfterWriteHistoryRepo(ctx)` and the param it travels through.
  - GET-history reads happen disarmed: D3b says to disarm before `GET /api/outputs/:id/history`, and task 2.3 repeats it.
  - The M3 timeout is expected, and D6 says to note it in the transcript.
  - Arming happens before run 2 and is keyed to the output ("Armed with N=2 before run 2", "for that output").
- **D3b is feasible against the live tree.**
  - `class OutputHistoryRepository(ctx: DbContext)(implicit ec)` is a plain, non-final class (OutputHistoryRepository.scala:60).
  - `def listRecent(outputId: String, limit: Int): Future[...]` is public and non-final (:81).
  - It has only two production callers: AlertEvaluationService.scala:145 (`k+1`) and OutputHistoryService.scala:93. Disarming before the GET read therefore isolates the counter to the evaluation path, which makes exactly one armed wait per run-2 evaluation (one baseline rule).
- **The wiring edges match the design's citations.**
  - ApiRoutes.scala:220 is the `outputHistoryRepo` param.
  - :253-254 is `resolvedOutputHistoryRepo = Option(outputHistoryRepo).getOrElse(...)`.
  - :413 is `new AlertEvaluationService(ruleRepo, eventRepo, resolvedOutputHistoryRepo)` (M1).
  - :460 is `outputHistoryRepo = resolvedOutputHistoryRepo` (M3).
  - :488 is OutputHistoryService.
  - `AlertEvaluationService`'s third param defaults to `null`, and the null branch logs a warning and skips (AlertEvaluationService.scala:131-137). So M1 compiles and is a real silent no-op.
- **D2 sequencing holds.**
  - `writesChain` runs `for { _ <- materializedWrites; _ <- binaryRefsUpsert; _ <- alertEvaluation; ... }` (PipelineRunService.scala ~1628-1636).
  - `publishTerminalAfter` (~997-1003) returns `writes`.
  - The route is `ServiceResponse.run(runService.submit(...))` (PipelineRunSubmitRoutes.scala:28).
- **M4 semantics hold.** `eligible` is `points.filterNot(_.runId.contains(triggeringRunId)).take(k)` at HistoryBaseline.scala:97, which matches the line D6 cites.
  - `listRecent` orders by `captured_at DESC, id DESC`. `capturedAt` is the wall-clock `Instant.now()` taken per run (PipelineRunService.scala:1439/1490). Run 2's point therefore sorts first, so under M4 with D3b the baseline is 100, the delta is 0, nothing breaches, and no event is written (red).
  - With correct code the baseline is 30, the delta is 70, and the rule fires (`gte 50`).
- **The current value comes from the summary reducer, not `extractMetric`.** `HistoryBaseline.currentValue` uses `OutputSummaryReducer` (HistoryBaseline.scala:85-91), and the threshold rule uses `extractMetric`. D3's numeric-cell requirement is what the threshold rule needs, and the event value shape `{value, baseline, delta, mode}` matches AlertEvaluationService.scala:155-160.
- **Scope check.** The plan covers all three ACs:
  - The composed spec with a run-twice baseline, a threshold rule and a history row (tasks 2.1-2.4).
  - A red under null history wiring (M1, task 3.1).
  - Different data across the runs (D3/D4, task 1.2/2.2).
  
  It stays test-only (task 3.5 checks that `git diff main -- backend/src/main` is empty), and it never touches OutputService.

### Verdict: CONFIRM

### Non-blocking notes

- **D6's expected failing lines for M1 and M2 are slightly off, given that the precondition is asserted first.**
  - Under M1, evaluation never calls `listRecent`, so the run-2 precondition (`satisfied >= 1`) goes red before the baseline-event assertion is reached. The red is still legitimate, because it is caused precisely by the cut edge.
  - Under M2, the run-1 threshold assertion reds first.
  
  The executor should record the actual failing assertion and not restructure the spec to match D6's predicted line. Optionally, the precondition failure message can name the likely cause ("evaluation never read history: wiring cut or D3b mis-armed").
- The D2 sequencing evidence (task 1.1) should cite the success-branch path from `submit` → `runPipeline` → `executeRunSuccess` → `onRunSuccess` → `writesChain`. That ties the 200 response to the completed chain, not just to the `for` block.
- To assert `pipeline_run_id` equals run 2's id, the executor needs run 2's id from the run response (`RunResultResponse`) or from `pipeline_runs`. Pick one and document it.
