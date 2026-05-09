## Context

The backend already has `SparkJobSubmitter`, `PipelineRunCache`, and `PipelineRunRoutes` (shipping with
HEL-202). `POST /api/pipelines/:id/run` returns a `runId`; `GET /api/pipelines/:id/runs/:runId` returns
`{ runId, status, rows?, error? }`. The in-memory `PipelineRunCache` (TrieMap) tracks state transitions:
Queued → Running → Succeeded | Failed. However, `PipelineRepository` has no method to persist
`lastRunStatus` / `lastRunAt` after a run completes, so the pipeline list view always shows null status.

The frontend's `PipelineDetailPage` has a `handleRunPipeline` stub that shows `window.alert("Pipeline
execution coming soon")`. The pipelines Redux slice has no run-related thunks or state.

## Goals / Non-Goals

**Goals:**
- Persist `lastRunStatus` and `lastRunAt` on the pipeline row when a run reaches a terminal state.
- Add `runPipeline` (POST) and `fetchRunStatus` (GET) to `pipelineService.ts`.
- Add a `submitPipelineRun` thunk + run-state slice fields to `pipelinesSlice`.
- Replace the placeholder in `PipelineDetailPage` with real run submission and interval polling.
- Show a run-status badge (queued / running / succeeded / failed / error) in the footer while active.

**Non-Goals:**
- Run history, cancellation, WebSocket/SSE streaming, row result display in the detail page.

## Decisions

**D1 — Persist via callback in SparkJobSubmitter.**
`SparkJobSubmitter.submit` already transitions cache state in the Spark thread. The cleanest approach
is to inject `PipelineRepository` and call `updateLastRun` inside the `catch`/success blocks, alongside
`cache.update`. Alternative: a separate polling actor — rejected as unnecessary complexity.

**D2 — Frontend polling with `setInterval`, not React Query or SWR.**
The project uses `createAsyncThunk` with raw `axios`; introducing a new data-fetching library is out of
scope. `setInterval` is used elsewhere (panel polling in `panelsSlice`). Polling interval: 2 s.
Stop on terminal states (`succeeded`, `failed`) or component unmount (`useEffect` cleanup).

**D3 — Run state co-located in `pipelinesSlice`.**
Run state (`runId`, `runStatus`, `runError`) belongs to the pipeline being edited. A separate
`pipelineRunSlice` would be premature given a single run at a time in the detail page.

**D4 — `updateLastRun` is a simple Slick update.**
`PipelineRepository` already has the Slick `PipelineTable` mapped — add a `def updateLastRun` that
issues `pipelinesTable.filter(_.id === id).map(r => (r.lastRunStatus, r.lastRunAt)).update(...)`.

## Risks / Trade-offs

- [Server restart loses in-flight run state from TrieMap] → Accepted: runs are short-lived; restart
  is unlikely mid-run in dev. Production hardening (durable run log) is a follow-up.
- [Polling adds N requests per open detail page] → Mitigated by stopping on terminal states and
  cleaning up on unmount; 2 s interval is acceptable for a dev-phase feature.

## Planner Notes

Self-approved: no new external dependencies, no breaking API changes, no new DB migrations needed
(the `last_run_status` / `last_run_at` columns already exist from the pipeline list migration).
