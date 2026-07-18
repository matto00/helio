## ADDED Requirements

### Requirement: SSE access-check failures do not produce 500s for valid requests or leak internals
The `GET /api/pipelines/:id/run-events` access check (`pipelineExistsShared` and its repository chain) SHALL NOT
fail — and therefore SHALL NOT produce a `500` response — for any valid request: an authenticated owner or grantee
of an existing pipeline SHALL receive `200` with `text/event-stream`, and a missing or unauthorized pipeline SHALL
receive `404`, regardless of pipeline run state (never-run, running, completed, failed), authentication mode
(session cookie or personal access token), or concurrent open streams.

If the access check nonetheless fails with an unexpected internal error, the endpoint SHALL respond `500` with a
generic error body that does not include the exception message, and SHALL log the full exception with stack trace
server-side.

#### Scenario: Previously-500ing valid request returns a proper stream
- **WHEN** an authorized user requests `run-events` for an existing pipeline under the probe-confirmed conditions
  that previously produced a 500
- **THEN** the response is `200 OK` with content-type `text/event-stream`

#### Scenario: Internal guard failure returns generic 500 without exception detail
- **WHEN** the access-check future fails with an unexpected internal exception
- **THEN** the response is `500` and the response body does not contain the exception message, and the exception
  with stack trace is logged server-side
