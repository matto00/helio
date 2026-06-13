## MODIFIED Requirements

### Requirement: SSE endpoint streams run status events for a pipeline
The backend SHALL expose `GET /api/pipelines/:id/run-events` as a Server-Sent Events endpoint using
Pekko HTTP `EventStreamMarshalling`. The response content type SHALL be `text/event-stream`. Each
event SHALL have `event: run-status` and a JSON `data` payload with at minimum a `status` field.
The stream SHALL remain open until a terminal status (`succeeded`, `failed`, or `dry_run`) is
emitted or the client disconnects.

Access SHALL be granted to the pipeline owner, editor grantees, and viewer grantees. Unauthenticated
requests SHALL receive `404 Not Found`. Authenticated users with no grant SHALL receive `404 Not Found`
(no existence leak). There is no public-viewer (anonymous) path for pipeline SSE.

#### Scenario: Owner can subscribe to SSE stream
- **WHEN** the pipeline owner issues `GET /api/pipelines/:id/run-events`
- **THEN** the response status is `200 OK` and content-type is `text/event-stream`

#### Scenario: Viewer grantee can subscribe to SSE stream
- **WHEN** a user with a viewer grant issues `GET /api/pipelines/:id/run-events`
- **THEN** the response status is `200 OK` and content-type is `text/event-stream`

#### Scenario: Editor grantee can subscribe to SSE stream
- **WHEN** a user with an editor grant issues `GET /api/pipelines/:id/run-events`
- **THEN** the response status is `200 OK` and content-type is `text/event-stream`

#### Scenario: No-grant user receives 404 on SSE
- **WHEN** an authenticated user with no grant issues `GET /api/pipelines/:id/run-events` for a pipeline
  they do not own
- **THEN** the response is `404 Not Found`

#### Scenario: Terminal event closes the stream
- **WHEN** a `succeeded`, `failed`, or `dry_run` status event is published for a pipeline
- **THEN** the SSE stream completes after emitting that event

#### Scenario: Unknown pipeline returns 404
- **WHEN** `GET /api/pipelines/:id/run-events` is called with a non-existent pipeline id
- **THEN** the response is `404 Not Found`
