## Why

Since HEL-1435, each history-thin transaction is bounded, but a whole retention pass (up to 20 batches) is still awaited
inside `PipelineSchedulerService.tick()`. `PipelineSchedulerActor` arms the next tick only when the previous one
completes, so every scheduled pipeline fire and every auto-run debounce waits for the whole pass:

- 96.7 s worst case on the S4 deep-backlog prod-class proxy, repeated for about 15 ticks;
- minutes per single batch under the cold strict-IO model.

The ticket asks that scheduled firing never be delayed by more than a stated bound.

## What Changes

- The scheduler tick starts the retention pass but no longer waits for it.
  - The tick still triggers retention (same cadence, same interval gate). Its completion, and so the next tick, is
    independent of how long a pass takes.
  - At most one retention pass runs per process at a time, whatever the purge interval is.
  - Failures are still logged and never fail the tick.
- The advisory-lock semantics (HEL-1272/1343), the next-due precedence, the batch-count budget and the in-process
  continuation cursor are unchanged.
- The test-only `OutputHistoryRepository.thinAndPurge` drain moves out of production code into test support.
- Polish:
  - the row-limit split test asserts exact batch composition;
  - measurements.md (HEL-1435 archive) states that `SET LOCAL work_mem` wasn't needed, and cites or drops the
    "first clone was the colder run" claim.
- New measurements, before and after on a scratch S4 prod-class proxy, of the tick duration while a retention pass runs.

## Capabilities

### New Capabilities

### Modified Capabilities
- `output-history-retention`: retention is triggered from the scheduler tick but never awaited by it. At most one pass
  is in flight per process.

## Impact

- Backend:
  - `PipelineSchedulerService` (the tick's history work);
  - `OutputHistoryRetentionService` (in-flight guard);
  - `OutputHistoryRepository` (`thinAndPurge` removed);
  - test support and the specs that call `thinAndPurge`;
  - the scheduler maintenance-hook specs.
- No migration, no API change.
- No new env var unless the design adds one.
- Prod: retention now runs concurrently with later ticks instead of stalling them.

## Non-goals

- Changing any retention default (batch rows/outputs/count, intervals), or the thinning SQL.
- Persisting the continuation cursor across restarts (it stays in-process; a restart restarts the cycle, as today).
- Lowering the total work of a cycle.
