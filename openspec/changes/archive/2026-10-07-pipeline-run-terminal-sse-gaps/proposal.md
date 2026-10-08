## Why

HEL-1366 made every terminal path in `PipelineRunService` publish exactly one terminal SSE event after its durable
writes. Two older paths still leave subscribers hanging (HEL-1370, confirmed against b14e622ee):

1. `executeRun` publishes `queued` before the HEL-505 guard checks. A submit rejected with `429` (rate limit or
   concurrency cap), or one whose guard check Future fails, publishes `queued` and nothing after it.
2. `onRunSuccess` handles `applyWriteBacks` returning `Left`, but a failed Future (any non-`IllegalStateException`
   DB error) skips both branches: no terminal event, and the `pipeline_runs` row stays non-terminal, where it keeps
   counting toward the HEL-505 concurrency cap.

## What Changes

- `queued` is published only once the run is admitted (rate limit passed; for a real run, the concurrency-cap insert
  returned `Inserted`/`NotOwned`). A rejected or guard-failed submit publishes no SSE event at all. The submitting
  caller still gets its `429` over HTTP, unchanged.
- A failed `applyWriteBacks` Future is routed through the existing `onWriteBackFailure` bookkeeping (terminal
  `failed` run row, last-run status, assertions, then exactly one `failed` event), with a generic `errorLog`. The
  raw cause is logged server-side. The HTTP outcome stays the same: the original exception still propagates.
- New red-first cases in `PipelineRunServiceTerminalOrderingSpec`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-run-sse`: `queued` is published on admission, not before the guard. A guard-rejected submit publishes
  nothing. A write-back that throws still ends in exactly one `failed` event.
- `pipeline-run-execution`: the same `queued`-on-admission wording, plus a write-back exception leaves the run row
  `failed`.

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` (small, local edits only)
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceTerminalOrderingSpec.scala`
- No wire-format, schema, migration or frontend change.

## Non-goals

- Refactoring or splitting `PipelineRunService` (HEL-1371).
- A new `rejected` SSE status, or any change to the 429 HTTP response.
- Changing how `Left` write-back failures or engine failures are reported.
