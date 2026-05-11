# pipeline-run-sse Specification

## Purpose
TBD - created by archiving change run-status-indicator. Update Purpose after archive.
## Requirements
### Requirement: SSE endpoint streams run status events for a pipeline
The backend SHALL expose `GET /api/pipelines/:id/run-events` as a Server-Sent Events endpoint using
Pekko HTTP `EventStreamMarshalling`. The response content type SHALL be `text/event-stream`. Each
event SHALL have `event: run-status` and a JSON `data` payload with at minimum a `status` field.
The stream SHALL remain open until a terminal status (`succeeded`, `failed`, or `dry_run`) is
emitted or the client disconnects.

#### Scenario: SSE connection returns text/event-stream content type
- **WHEN** a client issues `GET /api/pipelines/:id/run-events`
- **THEN** the response status is `200 OK` and content-type is `text/event-stream`

#### Scenario: Terminal event closes the stream
- **WHEN** a `succeeded`, `failed`, or `dry_run` status event is published for a pipeline
- **THEN** the SSE stream completes after emitting that event

#### Scenario: Unknown pipeline returns 404
- **WHEN** `GET /api/pipelines/:id/run-events` is called with a non-existent pipeline id
- **THEN** the response is `404 Not Found`

### Requirement: PipelineRunRegistry publishes status events at each run transition
The backend SHALL maintain an in-memory registry (`PipelineRunRegistry`) keyed by pipeline ID.
`PipelineRunRoutes` SHALL publish events to the registry at each status transition:
`queued` before execution starts, `running` after the engine begins, `succeeded` or `failed` on
completion, `dry_run` on successful dry-run completion. Events SHALL be ephemeral — not persisted
to the database.

#### Scenario: Queued event published before engine starts
- **WHEN** `POST /api/pipelines/:id/run` is received and pre-execution DB work begins
- **THEN** a `queued` event is published to the registry for that pipeline ID

#### Scenario: Running event published when engine starts
- **WHEN** the in-process engine begins executing steps
- **THEN** a `running` event is published to the registry for that pipeline ID

#### Scenario: Succeeded event carries row count
- **WHEN** a non-dry run completes successfully with N result rows
- **THEN** a `succeeded` event is published with `rowCount: N`

#### Scenario: Failed event carries error message
- **WHEN** a run fails with an exception message
- **THEN** a `failed` event is published with `errorLog` containing the error message

#### Scenario: Dry-run emits dry_run terminal event
- **WHEN** `POST /api/pipelines/:id/run?dry=true` completes successfully
- **THEN** a `dry_run` event is published with `rowCount` equal to the result row count

### Requirement: SSE subscriber receives events published after connection opens
A client that connects to `run-events` before a run is posted SHALL receive all subsequent
status events for that pipeline in order.

#### Scenario: Subscriber receives full event sequence for a run
- **WHEN** a client connects to `run-events`, then `POST /api/pipelines/:id/run` is called
- **THEN** the SSE stream delivers `queued`, `running`, and `succeeded` (or `failed`) events in order

#### Scenario: No events received for a different pipeline
- **WHEN** a client subscribes to pipeline A's run-events, and a run is posted for pipeline B
- **THEN** the client for pipeline A receives no events

