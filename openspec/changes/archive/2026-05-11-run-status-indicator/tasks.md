## 1. Backend

- [x] 1.1 Create `RunStatusEvent` case class with fields: `status`, `rowCount`, `errorLog`
- [x] 1.2 Create `PipelineRunRegistry` object with `subscribe(pipelineId)` and `publish(pipelineId, event)` using `ConcurrentHashMap` + `Source.actorRef`
- [x] 1.3 Add `EventStreamMarshalling` import and `run-events` GET route in `PipelineRunRoutes`
- [x] 1.4 Publish `queued` event at run start (before `preExec` and engine invocation)
- [x] 1.5 Publish `running` event immediately before `inProcessEngine.execute` is called
- [x] 1.6 Publish `succeeded` event with `rowCount` on successful non-dry run completion
- [x] 1.7 Publish `failed` event with `errorLog` on execution failure
- [x] 1.8 Publish `dry_run` event with `rowCount` on successful dry-run completion
- [x] 1.9 Register `run-events` route in `ApiRoutes.scala`
- [x] 1.10 Add `pekko-http-sse` or confirm `EventStreamMarshalling` is available in existing deps; update `build.sbt` if needed

## 2. Frontend

- [x] 2.1 Create `usePipelineRunEvents` hook in `frontend/src/hooks/` managing `EventSource` lifecycle
- [x] 2.2 Hook parses `run-status` event data JSON and returns `{ status, rowCount, errorLog }`
- [x] 2.3 Hook auto-closes `EventSource` on terminal status (`succeeded`, `failed`, `dry_run`)
- [x] 2.4 Hook closes `EventSource` when `active` prop flips to `false`
- [x] 2.5 Extend `StatusBadge` in `PipelineDetailPage.tsx` with `running` (spinner) and `queued` (pulse) CSS styles
- [x] 2.6 Wire `usePipelineRunEvents` into `PipelineDetailPage` — activate on run submit, deactivate on terminal
- [x] 2.7 On terminal SSE event dispatch `fetchPipelineRunHistory` to refresh history panel
- [x] 2.8 Display `rowCount` in succeeded inline label and `errorLog` in failed inline label from SSE data

## 3. Tests

- [x] 3.1 ScalaTest: `PipelineRunRegistry` publishes and subscriber receives events in order
- [x] 3.2 ScalaTest: SSE endpoint returns `text/event-stream` content-type for existing pipeline
- [x] 3.3 ScalaTest: SSE endpoint returns 404 for unknown pipeline
- [x] 3.4 ScalaTest: full run publishes queued → running → succeeded event sequence
- [x] 3.5 Jest: `usePipelineRunEvents` opens `EventSource` when `active=true`
- [x] 3.6 Jest: hook returns correct status/rowCount/errorLog from parsed events
- [x] 3.7 Jest: hook closes connection on terminal event
- [x] 3.8 Jest: `StatusBadge` renders spinner for `running` and pulse for `queued`
