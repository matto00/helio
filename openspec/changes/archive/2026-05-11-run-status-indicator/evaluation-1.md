# Evaluation Report — HEL-199 Cycle 1

## Overall: FAIL

## Critical Issues

### 1. SSE Authentication Failure (Blocks AC#5)

The SSE endpoint `GET /api/pipelines/:id/run-events` is behind `authDirectives.authenticate` in
`ApiRoutes.scala`. The browser `EventSource` API does not support custom headers, so every request
returns 401 Unauthorized. The real-time status update feature is completely non-functional.

**Evidence**: Frontend hook creates `new EventSource(url)` with no auth mechanism.
Server rejects with 401. UI shows no transient states (queued/running/spinner).

**Fix required (choose one):**
- Option A: Use `fetch`-based SSE streaming with `Authorization` header instead of `EventSource`:
  open the connection via `fetch`, read `response.body` as a `ReadableStream`, parse SSE lines
  manually. This keeps the endpoint authenticated.
- Option B: Exempt the `run-events` route from authentication at the route level in `ApiRoutes`
  (remove it from the authenticated block), relying on pipeline-ID obscurity. This is simpler
  but weaker security.

Option A is preferred.

## Non-Critical Observations

- Hook has no `onerror` handler — if connection drops mid-run, the user gets no feedback.
- Missing `Content-Type: text/event-stream` validation on the fetch response before reading.

## Acceptance Criteria Status

| AC | Status |
|----|--------|
| 1. Inline status shown during/after run | Partial — CSS correct, SSE broken |
| 2. In-progress spinner | Blocked by auth |
| 3. Succeeded checkmark + row count | Blocked by auth |
| 4. Failed error icon + message | Blocked by auth |
| 5. SSE used for real-time updates | FAIL — 401 Unauthorized |
| 6. Run-history REST endpoint intact | Pass |
| 7. Backend + frontend tests cover SSE | Partial — tests pass in isolation, don't catch runtime auth |
