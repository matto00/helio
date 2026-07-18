## Why

`GET /api/pipelines/:id/run-events` (SSE, `PipelineRunStreamRoutes.scala`) was observed returning HTTP 500 for a
valid, accessible pipeline during HEL-252's UI review. The 500 fires when the `pipelineExistsShared` future *fails*
(DB/query error, sharing lookup, possible RLS interaction) rather than resolving true/false — so the visible 500 is a
symptom of an unconfirmed underlying fault. The root cause has never been probed; per the systematic-debugging Iron
Law, this change is probe-first: reproduce → capture the server-side exception → fix that root cause.

## What Changes

- **Probe (mandatory, before any fix):** reproduce the 500 against a live backend and capture the underlying
  exception from `pipelineExistsShared` / `PipelineRepository.findByIdShared`. If it does not reproduce on current
  main, widen the matrix before concluding: pipeline states (never-run, running, completed, failed,
  deleted-mid-stream), auth modes (session cookie vs PAT), RLS context (HEL-286 SECURITY DEFINER history, V40,
  non-superuser role — dev runs as superuser/BYPASSRLS), and concurrent streams. Also verify what request the
  frontend consumer (StepCard / pipeline detail) actually issues.
- **Fix the probe-confirmed root cause** so a valid, authorized request always yields a `200 text/event-stream`
  response, and missing/unauthorized pipelines yield `404` — never a 500 for a valid request.
- **Harden the route's failure handling:** an internal failure of the access check must not leak raw exception
  messages to clients (current code returns `ex.getMessage` in the 500 body).
- **Regression coverage** for the previously-500ing path in the backend test suite.
- Fallback deliverable (only if genuinely not reproducible after the widened matrix): a documented probe report on
  the ticket — but route hardening + regression coverage still ship.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-run-sse`: add a requirement that internal failures of the access check are not surfaced as 500s with raw
  exception detail for valid requests; the previously-500ing path returns the correct 200/404 outcome and is covered
  by regression tests.

## Non-goals

- No changes to SSE event semantics, the registry, or run-status publishing.
- No frontend behavior changes unless the probe proves the client request itself is at fault.
- No broad RLS policy rework — only what the probe-confirmed root cause requires.

## Impact

- `backend/src/main/scala/com/helio/api/routes/PipelineRunStreamRoutes.scala`
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` (`pipelineExistsShared`)
- `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala` (`findByIdShared`) — if implicated
- Backend tests covering the SSE route guard; possibly RLS policies/migrations if the probe points there.
