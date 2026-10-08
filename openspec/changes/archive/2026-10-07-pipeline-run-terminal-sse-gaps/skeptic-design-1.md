## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD: b14e622ee325c32569a452b6d9a8eb1d826ca76b (change dir untracked, no code changes yet).

### What I verified (with evidence)

- **Both premises hold in the code.**
  - Path 1: `PipelineRunService.scala:1030` publishes `queued` without any condition, before `rateLimitCheck` (1037-1043) and before `insertRunIfUnderConcurrencyCap` (1055-1069). Both `Left(TooManyRequests)` branches (1046, 1072) return with nothing published after `queued`.
  - Path 2: `onRunSuccess` (1300-1307) is `applyPendingWriteBacks(...).flatMap { Left => onWriteBackFailure; Right => onUnblockedRunSuccess }`. `DataSourceRepository.applyWriteBacks` (465-503) recovers only `IllegalStateException`, so any other DB error is a failed Future. That Future skips both branches, which means no `publishTerminalAfter` runs and the run row is left non-terminal. A non-terminal row counts toward the cap: `nonTerminalCountAction` in `insertRunIfUnderConcurrencyCap` filters out only succeeded/failed/dry_run.
- **D1 is clearly correct, so self-approving it is justified.**
  - `PipelineRunRegistry.broadcastLocal` (`PipelineRunRegistry.scala:130-137`) sends `ActorStatus.Success` to every ref for that pipeline id on any terminal status, then calls `refs.remove(pipelineId)`. Subscribers are keyed by pipeline, not by run, so a synthetic terminal event for a rejected submit would close the stream of every in-flight run on that pipeline.
  - On a rejected submit, `CapExceeded` inserts no row: the insert sits inside the `count < maxConcurrent` branch. The rate-limit `Left` writes nothing (repo doc, and the short-circuit at `limit < 1`). A synthetic `failed` event would therefore describe a run that `runs/latest` never shows.
  - On the frontend, `pipelineRunFanout.ts` fires `terminalListeners` on a live `failed` event. A fake one would notify dashboards about a run that never existed.
  - The ticket's own "Do" list allows "never publish queued for a rejected submit". D1 picks an option the ticket author already approved, and the code shows the other option does harm.
- **No consumer depends on `queued` arriving before the guard.**
  - `PipelineRunRoutesSpec` (970/1023/1050) asserts event order only, and that order is unchanged.
  - `PipelineRunGuardIntegrationSpec` passes `registry = null`.
  - `PipelineRunCrossInstanceSpec` publishes `queued` directly.
  - `pipelinesSlice.ts:551` sets `queued` locally on `submitPipelineRun.pending`.
  - `usePipelineRunEvents.ts` only overwrites state.
  - helio-mcp has no SSE consumer. The only e2e that touches 429 (`hel1096-run-to-update-affordance.spec.ts`) mocks the HTTP 429 and has no SSE dependency.
- **D2 is sound and cannot double-publish, as long as the recovery wraps only `applyPendingWriteBacks`.** A recovered-and-re-failed Future skips the downstream `flatMap`, so `onWriteBackFailure` (via `publishTerminalAfter`, 990-996) publishes exactly once, even if its own writes fail. `submit` has five callers:
  - `PipelineRunSubmitRoutes:28`
  - `PipelineSchedulerService:152` (auto-run) and `:230` (scheduled)
  - `HookTriggerService:74`
  - `PipelineProposalService:525`

  None of them publishes SSE events itself (grep: the only `RunStatusEvent(` constructions outside the service are in the registry/bus). Re-failing with the original exception leaves each caller's observable outcome byte-identical to today.
- **The D3 tests can be red on b14e622ee.**
  - Concurrency-cap case: B's `queued` is published before the cap check, so B's runId reaches the subscriber. The harness already passes a real `runRepo`, so the cap is live, and the constructor has a `guardConfig` parameter.
  - Write-back exception case: a PL/pgSQL `RAISE` arrives as a `PSQLException`, not an `IllegalStateException`, so the Future fails and the case is red through `awaitTerminal`.
  - Rate-limit case: see CR2. One of the two suggested setups would be vacuous.
- **C1 (minimal diff).** The edits are local: move one line, and wrap one call in about eight lines. `check-scala-quality.mjs`'s 250-line budget is a soft warning only (line 82), so these edits cannot force an extraction.
- **Spec delta:** the `pipeline-run-sse` MODIFIED block diffs cleanly against `openspec/specs/pipeline-run-sse/spec.md`, and every original scenario is preserved.

### Verdict: REFUTE

### Change Requests

1. **Missing contract delta: `pipeline-run-execution` contradicts D1 and has no delta planned.** `openspec/specs/pipeline-run-execution/spec.md` has two statements that become false after the change:
   - Line 264: "`queued` when pre-execution begins".
   - Lines 286-288, Scenario "SSE queued event published before engine starts": "WHEN … pre-execution work begins THEN a `queued` RunStatusEvent is published".

   After D1, a submit rejected by the cap does begin pre-execution work (the cap-check transaction *is* that work) but publishes no `queued`. The planner already reworded the identical phrase in `pipeline-run-sse` ("pre-execution DB work begins" → "admitted by the pipeline-run guard"), so the sibling capability has to change the same way. Add `specs/pipeline-run-execution/spec.md` with a MODIFIED "Non-dry run persists a pipeline_runs record" requirement that:
   - rewords line 264 and that scenario to "once admitted by the pipeline-run guard";
   - optionally adds that a write-back exception also leaves the row `failed`, since D2 now guarantees it.

   Add a matching task line too.
2. **D3 rate-limit case: drop the vacuous "one admitted dry run first" setup and specify `rateLimitPerWindow = 0`.** `harness()` opens the `Subscriber` at construction, before any submit. A priming dry run publishes `dry_run`, which is terminal, so `broadcastLocal` completes and removes the subscriber. On b14e622ee the rejected submit's `queued` then reaches nobody, and the case passes before the fix. C2 would catch this, but only after time was wasted. `incrementRateIfUnderLimit` treats `limit < 1` as "always capped" before touching the DB (`PipelineRunGuardRepository.scala:50`). With 0, the first submit is rejected with no priming run, and the subscriber is still open to receive the red `queued`. Make design.md D3 and task 2.2 name this setup explicitly. If a primed variant is ever wanted, the subscriber must be opened after the priming run's terminal event.

### Non-blocking notes

- D2: state what the recovered Future fails with when `onWriteBackFailure`'s own writes also fail. "Re-fail with the original `ex`" reads as "always the original". Make that explicit, for example `onWriteBackFailure(...).transformWith(_ => Future.failed(ex))`, so the implementer doesn't write a `flatMap` that surfaces the secondary error instead.
- D2's caller list names "routes, scheduler, auto-run". There are also `HookTriggerService.submit` and `PipelineProposalService` (apply-proposal then run). Re-failing with the original exception keeps both unchanged, but the list should be complete.
- Out of scope, recorded for HEL-1371 or a follow-up: other code paths can still miss a terminal event after `running` is published. A synchronous throw inside the `preExec.flatMap` body (for example `backend.execute` throwing instead of returning a failed Future), or inside `executeRunSuccess`'s pre-`followUp` computations (`truncationFields`, `anyToJsValue` over `jsRows`), becomes a failed Future that no `publishTerminalAfter` covers. HEL-1370 names only two paths, so this is not scope for it.
- The design's statement that the run row "stays `queued`" was not re-verified (the cap counts any non-terminal status). This does not affect the fix.
