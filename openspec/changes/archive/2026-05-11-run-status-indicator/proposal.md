## Why

The pipeline run button gives no real-time feedback — the UI is static until the HTTP response
returns, and users have no way to know whether the run is queued, executing, or finished without
manually refreshing the history panel. SSE-based status events let the UI reflect state
transitions (queued → running → succeeded/failed/dry_run) as they happen.

## What Changes

- **New SSE endpoint** `GET /api/pipelines/:id/run-events` streams `RunStatus` events for a
  pipeline using Pekko HTTP's `EventStreamMarshalling`. Events are ephemeral (not persisted).
- **Backend publish hooks** in `PipelineRunRoutes` emit events at each status transition
  (queued, running, succeeded, failed, dry_run).
- **New frontend hook** `usePipelineRunEvents` opens an `EventSource` connection while a run is
  active, feeds status into local component state, and closes on terminal event.
- **`StatusBadge` extension** to render transient states: a spinner/pulsing dot for `running`,
  a queued indicator for `queued` (already has succeeded/failed/dry_run from HEL-197).
- **`PipelineDetailPage`** wires the hook and replaces the existing polling/thunk-based status
  display with SSE-driven state during a run.

## Capabilities

### New Capabilities
- `pipeline-run-sse`: Backend SSE endpoint + publish infrastructure for streaming run status events
- `pipeline-run-status-ui`: Frontend hook, StatusBadge transient states, and PipelineDetailPage wiring

### Modified Capabilities
- `pipeline-run-execution`: Adds requirement that status transitions publish SSE events; existing
  REST run endpoint behavior unchanged

## Impact

- **Backend**: new SSE route registered in `ApiRoutes`; `PipelineRunRoutes` gains a
  `BroadcastHub`/`MergeHub` or `Source.actorRef`-based publish channel; `InProcessPipelineEngine`
  unchanged (status transitions happen in the route handler, not the engine).
- **Frontend**: new `usePipelineRunEvents` hook; `StatusBadge` gains `running` and `queued` style
  variants; `PipelineDetailPage` subscribes to the hook when a run is dispatched.
- **Tests**: ScalaTest for SSE endpoint event sequence; Jest for hook + badge states.
- **No DB schema change** — events are ephemeral; the `pipeline_runs` row remains the source of
  truth.

## Non-goals

- WebSockets.
- Persisting SSE events to the database.
- Progress percentage reporting (deferred to follow-up if it requires engine refactoring).
- Multi-run concurrency (single active run per pipeline assumed).
