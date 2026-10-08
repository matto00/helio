## Context

All line numbers are against b14e622ee (`PipelineRunService.scala`).

- `executeRun` publishes `queued` at ~1030, then runs `rateLimitCheck` (~1037) and, for a real run, `preExec`'s
  `insertRunIfUnderConcurrencyCap` (~1055). Both reject with `Future.successful(Left(TooManyRequests))` and publish
  nothing further. A failed guard Future (DB error) also publishes nothing further.
- `onRunSuccess` (~1300) calls `applyPendingWriteBacks(...).flatMap { Left => onWriteBackFailure; Right => ... }`.
  `DataSourceRepository.applyWriteBacks` recovers only `IllegalStateException` into `Left`, so any other DB error is
  a failed Future. That skips both branches, so no `publishTerminalAfter` runs and the run row stays `queued`.
- `PipelineRunRegistry.broadcastLocal` completes **every** subscriber of the pipeline on any terminal event. Its
  `refs` are keyed by pipeline id, not by run id.
- Frontend `usePipelineRunEvents` sets `status` from every non-`node-progress` event. `PipelineDetailFooter` disables
  Run while `status` is `queued`/`running`, and a stray `queued` keeps it disabled until a terminal event arrives.

## Goals / Non-Goals

**Goals:** a guard-rejected submit never leaves a subscriber with an unterminated `queued`. A write-back exception
ends in exactly one `failed` event, published after the run's failed state is durable. Each case is red first.

**Non-Goals:** splitting or refactoring the file (HEL-1371), a new SSE status, or changing any HTTP status code.

## Decisions

### D1: For a rejected submit, never publish `queued`. Do not invent a terminal event.

Move the `queued` publish to just before the `running` publish, inside `preExec.flatMap`'s `Right(())` branch. That
point is reached only after the rate limit passed and, for a real run, after the concurrency-cap insert returned
`Inserted`/`NotOwned` (the run row is committed as `queued` by then, so the event now matches durable state). Dry runs
skip the cap and reach the same point once the rate limit passes.

The ticket allows either option. The code makes this one clearly correct, so it is self-approved, not escalated:
- A terminal event is per-pipeline in effect: `broadcastLocal` completes all of the pipeline's subscribers. A
  concurrency-cap 429 happens only while other runs of the user are in flight, and often on the same pipeline. A
  synthetic `failed` for the rejected submit would close every dashboard's stream before the in-flight run's real
  terminal event, and the footer would show `failed` while a run is still running.
- A rejected submit has no `pipeline_runs` row and does not touch `pipelines.last_run_status`. A terminal `failed`
  would describe a run that run history and `GET .../runs/latest` never show.
- "Queued" means admitted. The submitter already learns about the rejection from the HTTP `429` and its `Retry-After`.

Behavior change on the wire: `queued` now follows the guard's DB round-trips instead of preceding them. The event
order (`queued` → `running` → node-progress → terminal) is unchanged. The `pipeline-run-sse` scenario "Queued event
published before engine starts" keeps its name, but its WHEN/THEN now say "admitted by the guard". The sibling
`pipeline-run-execution` requirement "Non-dry run persists a pipeline_runs record" makes the same `queued`
statement, and its scenario "SSE queued event published before engine starts" gets the same rewording, through a
MODIFIED delta. That delta also adds that a write-back exception leaves the row `failed` (D2).

### D2: Route a failed write-back Future through `onWriteBackFailure`, keeping the HTTP outcome

In `onRunSuccess`, wrap only the `applyPendingWriteBacks` call. Start it inside `Future.unit.flatMap`, so a synchronous
throw also becomes a failed Future. Recover `NonFatal(ex)` this way:

1. Log the raw cause (`log.error`, the HEL-311 pattern).
2. Call `onWriteBackFailure(..., errMsg = "Step (upsertsource): write-back failed")`. This is the same bookkeeping as
   the `Left` branch: terminal `failed` run row, last-run status, assertions, then exactly one `failed` event through
   `publishTerminalAfter`.
3. Re-fail with the original `ex` ALWAYS, even if `onWriteBackFailure`'s own writes fail. Shape:
   `onWriteBackFailure(...).transformWith(_ => Future.failed(ex))`, never a `flatMap` that would surface the
   secondary error. Every `submit` caller then sees the same failed Future as today: `PipelineRunSubmitRoutes`,
   `PipelineSchedulerService` (scheduled and auto-run), `HookTriggerService` and `PipelineProposalService`. None of
   them publishes SSE events itself.

The recovery wraps only the write-back call, never the downstream `flatMap`. `onWriteBackFailure` and
`onUnblockedRunSuccess` already publish their own terminal events, so wrapping them would double-publish when they
fail. The message is generic because the raw exception can carry SQL or internal detail (HEL-311). `upsertsource` is
kept as the prefix so the message names the failing step kind, matching the `Left` branch's `Step (upsertsource): …`.

Alternative rejected: mapping the exception to `Left(UnprocessableEntity)` (422). That changes a product-visible HTTP
status, which is out of scope for an SSE robustness fix.

### D3: Tests (red first), in `PipelineRunServiceTerminalOrderingSpec`

Extend the existing harness (optional guard repo + guard config, and an optional `DataSourceRepository` override if
needed). Each case must fail on b14e622ee and pass after the fix. Record the red run's output.
- **Rate-limit 429:** guard config with `rateLimitPerWindow = 0`. `incrementRateIfUnderLimit` treats `limit < 1` as
  always capped, before any DB work (`PipelineRunGuardRepository.scala:50`). Do NOT prime with an admitted run: its
  terminal event would complete and remove the subscriber, so on b14e622ee the rejected `queued` would reach nobody
  and the case would pass vacuously. If a primed variant is ever wanted, open the subscriber after the priming run's
  terminal event. The rejected submit returns `Left(TooManyRequests)`, and the subscriber sees no event from it (red
  today: `queued`). Non-vacuity: the subscriber stays open, so an event published afterwards on the same pipeline
  (directly via `registry.publish`, since a limit of 0 admits no submit) still reaches it.
- **Concurrency-cap 429:** `maxConcurrent = 1`. Run A is held at the gating backend, and run B is rejected with
  `TooManyRequests`. Every event the subscriber received carries run A's `runId`, so there is no `queued` for B (red
  today). After the gate opens, run A's own terminal event reaches the same subscriber.
- **Write-back exception:** cause a real non-`IllegalStateException` failure inside `applyWriteBacks`. Prefer a
  test-only trigger that raises on the target dataset's row write (mirroring `withFailingTerminalUpdate`) over a
  stubbed repository. Expect exactly one `failed` event (witness-bus count), with `errorLog` containing
  `upsertsource`, after the run's `failed` status is durable (row-lock ordering as in `finishFailedCase`), and the
  submit still completes as a failed Future. Red today: no terminal event, and the run stays non-terminal.

## Risks / Trade-offs

- An observer that relied on `queued` arriving before the guard round-trip sees it a few ms later. Nothing in the repo
  depends on that timing: `PipelineRunRoutesSpec` asserts order only, and the frontend sets `queued` locally on
  submit (`pipelinesSlice`).
- With D1, a guard-failed Future (DB down) publishes nothing. That is acceptable, because nothing was admitted.

## Out of scope (recorded for HEL-1371 or a follow-up)

After `running` is published, a synchronous throw inside the `preExec.flatMap` body (`backend.execute` throwing
instead of returning a failed Future) or inside `executeRunSuccess`'s pre-`followUp` computations can still miss a
terminal event. HEL-1370 names only two paths, so this is not in scope here (skeptic-design-1 note).

## Planner Notes

- Self-approved D1 per the driver's rule "escalate unless the code makes one option clearly correct". The registry's
  per-pipeline terminal completion (D1's first bullet) is the deciding fact.
- Self-approved D2's "re-fail with the original exception" to keep HTTP behavior unchanged.
