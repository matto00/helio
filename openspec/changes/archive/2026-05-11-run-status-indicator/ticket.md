# HEL-199 — Run status indicator in pipeline UI

## Title
Run status indicator in pipeline UI

## Description
Inline status indicator during and after a run: in-progress (spinner), succeeded (checkmark + row count), failed (error icon + message). Error message surfaces the failing step and reason.

## Architectural Direction (mandatory)

Use **Server-Sent Events (SSE)** for run status, not polling. While a run is executing, the backend streams status events through an SSE connection to the frontend.

### Backend
- New SSE endpoint: `GET /api/pipelines/:id/run-events` (or `/api/pipeline-runs/:runId/events`) that emits `RunStatus` events.
- Pekko HTTP supports SSE via `ServerSentEvent`. Use `Source.actorRef` or a `BroadcastHub`+`MergeHub` pattern keyed by pipeline/run ID so the engine can publish events that subscribers receive.
- When `PipelineRunRoutes` transitions a run's status (`queued → running → succeeded/failed`), publish an event to the SSE channel for that pipeline/run.
- Keep the existing REST run-history endpoint — SSE is additive.
- Events are ephemeral (not persisted to DB); the run row remains the source of truth for final status.

### Stretch Goal (judgment call)
If progress reporting fits cleanly (emit progress events from `InProcessPipelineEngine` between steps without major refactoring), include it. Otherwise leave progress for a follow-up. Err on tight scope.

### Frontend
- `useEventSource`-style hook (or extend existing thunk pattern) that opens an SSE connection while a run is active.
- `StatusBadge` already exists (HEL-197) — extend to show transient states (running, queued) with spinner or pulsing dot for `running`.
- On `succeeded`/`failed`/`dry_run` terminal event, close the SSE connection and refresh run history.

### Tests
- Backend: ScalaTest for SSE endpoint emitting expected event sequence; test that publishing a status update reaches subscribers.
- Frontend: Jest tests for the hook handling event types, reconnection on transient close, and StatusBadge rendering states.

## Out of Scope
- WebSockets (SSE is one-way and sufficient).
- Persisting events to DB.

## Acceptance Criteria
1. Inline status indicator shown during and after a run.
2. In-progress state shows spinner.
3. Succeeded state shows checkmark + row count.
4. Failed state shows error icon + message (surfacing failing step and reason).
5. SSE connection is used for real-time status updates (not polling).
6. Existing run-history REST endpoint remains functional.
7. Backend and frontend tests cover the new SSE flow.
