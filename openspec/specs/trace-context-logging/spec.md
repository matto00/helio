# trace-context-logging Specification

## Purpose
Captures the Cloud Run `X-Cloud-Trace-Context` trace id at the HTTP request boundary and propagates it into the
SLF4J MDC (under the Cloud Logging canonical `logging.googleapis.com/trace` key) for every log line the request
emits — including asynchronous ones — so app logs correlate to the originating request trace, with no cross-request
leakage.
## Requirements
### Requirement: Trace id from X-Cloud-Trace-Context is placed into the logging MDC

The backend SHALL, at the HTTP request boundary, read the `X-Cloud-Trace-Context` request header and place the
extracted trace id into the SLF4J Mapped Diagnostic Context (MDC) for the duration of that request's handling. The
trace id is the substring of the header value before the first `/` (Cloud Run format
`TRACE_ID/SPAN_ID;o=TRACE_TRUE`). Because the JSON encoder from `structured-json-logging` emits every MDC entry as a
field, the trace id SHALL thereby appear as a searchable field on log lines emitted while handling the request.

#### Scenario: Trace id appears on JSON log lines for a traced request

- **WHEN** a request arrives carrying `X-Cloud-Trace-Context: abc123def456/789;o=1` and `LOG_FORMAT=json`
- **THEN** log lines emitted while handling that request SHALL carry the trace id `abc123def456` as a field

#### Scenario: Only the trace id portion is extracted

- **WHEN** the header value is `TRACE/SPAN;o=1`
- **THEN** the MDC trace value SHALL be derived from `TRACE` only, excluding the span and options segments

### Requirement: Trace is emitted under the Cloud Logging canonical field

The MDC entry SHALL use the Cloud Logging canonical trace key `logging.googleapis.com/trace`. When a Google Cloud
project id is configured (via a `GOOGLE_CLOUD_PROJECT` environment variable), the value SHALL be the fully-qualified
resource name `projects/PROJECT_ID/traces/TRACE_ID` so Cloud Logging correlates the app log line to the request
trace. When no project id is configured, the value SHALL be the bare trace id so local/dev traces are still visible.

#### Scenario: Fully-qualified trace value in production

- **WHEN** `GOOGLE_CLOUD_PROJECT=my-proj` is set and a request carries trace id `abc123`
- **THEN** the `logging.googleapis.com/trace` MDC field SHALL equal `projects/my-proj/traces/abc123`

#### Scenario: Bare trace value when project id absent

- **WHEN** no project id env var is set and a request carries trace id `abc123`
- **THEN** the `logging.googleapis.com/trace` MDC field SHALL equal `abc123`

### Requirement: Trace reaches asynchronous log statements during the request

The trace SHALL be present in the MDC on the threads that emit the request's log lines, including logs emitted from
asynchronous `Future`/`onComplete` callbacks during request handling (for example the failure-path error logs in
`ApiRoutes`), not merely on the thread that first evaluated the route directives. The chosen mechanism SHALL be
verified against an actual emitted log line rather than assumed.

#### Scenario: Async failure log carries the trace

- **WHEN** a traced request triggers a handler that logs an error from an asynchronous callback with `LOG_FORMAT=json`
- **THEN** that error log line SHALL carry the request's trace id

### Requirement: Requests without the header are unaffected and MDC never leaks

When a request does not carry `X-Cloud-Trace-Context`, handling SHALL proceed exactly as before with no error and no
trace key added to the MDC. Regardless of whether the header was present or handling succeeded or failed, the
backend SHALL remove the trace MDC key when the request completes so that a pooled worker thread never carries a
stale trace id into a subsequent request.

#### Scenario: Missing header adds no trace key

- **WHEN** a request arrives without an `X-Cloud-Trace-Context` header
- **THEN** handling SHALL succeed as before and no `logging.googleapis.com/trace` field SHALL be added

#### Scenario: MDC is cleared after the request

- **WHEN** a traced request completes and the same worker thread later handles an untraced request
- **THEN** log lines for the second request SHALL NOT carry the first request's trace id

