# HEL-299 — `GET /api/pipelines/:id/run-events` (SSE) returns 500 on a valid pipeline

- **Type:** Bug
- **Priority:** Medium
- **Status:** In Progress
- **URL:** https://linear.app/helioapp/issue/HEL-299/get-apipipelinesidrun-events-sse-returns-500-on-a-valid-pipeline

## Symptom

`GET /api/pipelines/:id/run-events` — the SSE stream of pipeline run-status events (`PipelineRunStreamRoutes.scala`) — was observed returning **HTTP 500** while exercising `StepCard` during HEL-252's UI review. Confirmed **pre-existing** and unrelated to HEL-252 (no backend/SSE files were touched by that change).

## Where it surfaces

`backend/src/main/scala/com/helio/api/routes/PipelineRunStreamRoutes.scala:26-28`:

```scala
onComplete(runService.pipelineExistsShared(pipelineId, user)) {
  case Failure(ex) =>
    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
  ...
```

The 500 is emitted when the `pipelineExistsShared(pipelineId, user)` future **fails** (as opposed to resolving `true`/`false`). So the visible 500 is a symptom — the real fault is whatever makes that future fail (a DB/query error, a sharing-lookup issue, an RLS interaction, etc.).

## Not-yet-confirmed root cause

This was an incidental observation, **not** a probed root cause. Do NOT assume the failure mode — first reproduce and instrument `pipelineExistsShared` (and its repository/SQL) to capture the actual exception before fixing. (See the systematic-debugging Iron Law: no fix without a probe-confirmed root cause.)

## Acceptance criteria

- Reproduce the 500 against a valid, accessible pipeline id and capture the underlying exception.
- Fix the root cause so the endpoint returns a proper SSE `200` stream for an authorized pipeline (or an appropriate 4xx — 404/403 — for missing/unauthorized), never a 500 for a valid request.
- Add regression coverage for the previously-500ing path.

## Orchestrator briefing (from human, binding)

- **Probe-first mandate (Iron Law is the whole ticket):** reproduce the 500 with a live backend, capture the server-side stack trace, identify the failing code path — before any fix.
- **If the 500 does NOT reproduce on current main, do NOT close as not-reproducible without widening the matrix:**
  - Pipelines in different states: never-run, running, completed, failed, deleted-mid-stream.
  - Auth variations: session cookie vs PAT.
  - RLS context: this endpoint may interact with the HEL-286 SECURITY DEFINER/RLS history — check migration V40 and the RLS policies. Dev/CI Postgres runs as superuser (BYPASSRLS), so RLS failures may only manifest with a non-superuser role. If evidence points at RLS, say so explicitly and test with a non-superuser connection per the team's RLS repro notes.
  - Concurrent streams.
- **Frontend consumer:** StepCard / pipeline detail — check what request it actually issues (headers, auth, Last-Event-ID reconnects).
- **Deliverable:** root cause + fix + regression test, or (only if genuinely not reproducible after the widened matrix) a documented probe report on the ticket.
- Context to verify, not trust: main includes v1.5 + fleet PRs #236–238.
