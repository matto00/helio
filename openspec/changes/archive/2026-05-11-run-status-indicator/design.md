## Context

`PipelineRunRoutes` currently executes runs synchronously — the HTTP response is only sent after
execution completes. `PipelineDetailPage` tracks run status through local `useState` that flips
between `queued → running → succeeded/failed` but is driven purely by the single HTTP promise
(`submitPipelineRun` thunk). There is no SSE infrastructure in the codebase today.

The `pipeline_runs` table (written by `PipelineRunRoutes`) is the persistent source of truth.
SSE events are ephemeral overlays: they let the UI reflect state transitions in real time without
polling, but no event is persisted.

## Goals / Non-Goals

**Goals:**
- Stream run status events (queued, running, succeeded, failed, dry_run) to subscribers over SSE
- New `GET /api/pipelines/:id/run-events` endpoint using Pekko HTTP `EventStreamMarshalling`
- `usePipelineRunEvents` hook opens SSE on run start, closes on terminal event, then refreshes history
- `StatusBadge` gains `running` (spinner) and `queued` (pulse) rendering; existing states unchanged
- ScalaTest + Jest coverage for the new SSE path

**Non-Goals:**
- Progress percentage events (deferred; would require engine callback refactor)
- Persisting SSE events to the DB
- Multi-run concurrency (single active run per pipeline assumed)
- WebSockets

## Decisions

### D1 — Endpoint: `/api/pipelines/:id/run-events` over `/api/pipeline-runs/:runId/events`
Pipeline-scoped URL is simpler: the frontend knows the pipeline ID before a run starts, so it can
open the SSE connection immediately before posting to `/run`. A run-scoped URL would require a
round-trip to get the `runId` first, adding latency. Single-active-run assumption makes
pipeline-scoped sufficient.

### D2 — Publish channel: `Source.actorRef` per pipeline, stored in a `ConcurrentHashMap`
A `ConcurrentHashMap[String, ActorRef[RunStatus]]` keyed by pipeline ID holds a single actor ref
per pipeline. When the SSE GET request arrives, a new `Source.actorRef` is materialised and its
ref stored. When `PipelineRunRoutes` transitions status it looks up the ref and sends the event.
On terminal event the actor self-terminates, completing the source and closing the SSE stream.

`BroadcastHub` would support multiple subscribers but adds wiring complexity without benefit
(single subscriber per pipeline assumed). `Source.actorRef` is lighter and already in Pekko HTTP.

### D3 — Status event wire format: plain-text `data:` with JSON payload
`ServerSentEvent(data = json, eventType = Some("run-status"))`. Frontend parses `event.data` as
JSON with fields `{ status, rowCount?, errorLog? }`. Named event type lets the hook ignore
unrelated SSE messages (e.g. heartbeats if added later).

### D4 — `PipelineRunRegistry` service object owns the channel map
A new `object PipelineRunRegistry` (or companion of the class) exposes:
- `subscribe(pipelineId): Source[ServerSentEvent, NotUsed]`
- `publish(pipelineId, event: RunStatusEvent): Unit`

This keeps `PipelineRunRoutes` from holding mutable state itself and lets the registry be
constructed once in `ApiRoutes` and injected.

### D5 — Frontend hook: `usePipelineRunEvents(pipelineId, active)`
Wraps `EventSource`. Opens connection when `active` is true, closes on terminal event or when
`active` flips false. Returns `{ status, rowCount, errorLog }`. `PipelineDetailPage` sets
`active = true` immediately on run submit and feeds hook output into existing UI state.

## Risks / Trade-offs

- `Source.actorRef` buffer overflow if status events arrive faster than the SSE connection drains
  → Mitigation: buffer size 8 with `OverflowStrategy.dropHead`; at most 5 status events per run.
- Old `ActorRef` left in map if client disconnects before terminal event
  → Mitigation: `Source.actorRef` materialises a ref that auto-terminates when the stream
  completes (client disconnect); `PipelineRunRegistry.publish` is a no-op if ref is gone (dead
  letter). No manual cleanup needed.
- CORS: Vite dev proxy already forwards `/api` — SSE connections go through the same proxy,
  no extra CORS config needed in development.

## Migration Plan

1. Add `PipelineRunRegistry` object (no DB migration needed — purely in-memory).
2. Extend `PipelineRunRoutes` to publish status events at each transition point.
3. Register new `run-events` route in `ApiRoutes`.
4. Add `usePipelineRunEvents` hook; wire into `PipelineDetailPage`.
5. Extend `StatusBadge` with running/queued styles.

## Open Questions

None — architectural direction is mandated by the ticket; progress events explicitly deferred.

## Planner Notes

Self-approved: no external dependencies, no DB changes, additive backend route, no breaking API
changes. SSE is well-supported by Pekko HTTP and native browser `EventSource`.
