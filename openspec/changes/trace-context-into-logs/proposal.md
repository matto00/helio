## Why

HEL-115 gave us structured JSON logs whose `LogstashEncoder` already emits every MDC entry as a searchable field,
but nothing populates the MDC with request identity. In Cloud Run, each request's access log carries an
`X-Cloud-Trace-Context` trace ID; without propagating it into our app logs there is no way to pivot from a single
request in the Cloud Run request log to all application log lines that request produced. This closes that gap.

## What Changes

- Extract the trace ID from the incoming `X-Cloud-Trace-Context` header (the substring before `/`) at the HTTP
  request boundary and place it into the SLF4J MDC so it is attached to log lines emitted while handling that request.
- Emit the trace under the Cloud Logging canonical MDC key `logging.googleapis.com/trace` with the fully-qualified
  value `projects/PROJECT_ID/traces/TRACE_ID`, so Cloud Logging correlates app logs to the request trace. The
  project id comes from a `GOOGLE_CLOUD_PROJECT`-style env var; absent it, fall back to the bare trace id.
- Ensure the trace reaches the log lines that matter, including async `onComplete` failure logs in `ApiRoutes` that
  run on execution-context threads (not just synchronous route evaluation) — the approach must be probe-verified.
- Always clear the MDC keys after the request completes so a pooled thread never carries a stale trace into a later
  request.
- Requests without the header behave exactly as today: no error, no stray MDC key.

## Non-goals

- No span/parent propagation, sampling, or distributed tracing backend (OpenTelemetry). Trace id only.
- No change to the `LOG_FORMAT` selection, the encoder, or the plain-text format from HEL-115.
- No new HTTP endpoints and no frontend changes.

## Capabilities

### New Capabilities

- `trace-context-logging`: Request-boundary extraction of the Cloud Run trace id into the logging MDC, its Cloud
  Logging field mapping, async propagation guarantee, and post-request cleanup.

### Modified Capabilities

<!-- none: the structured-json-logging encoder is unchanged; this only populates MDC it already emits. -->

## Impact

- Backend only: a new Pekko HTTP directive (`api/`) wrapping the route tree in `ApiRoutes.scala`; possibly a small
  MDC-aware execution-context helper if the probe shows async logs need it. New optional env var for project id.
- No schema, migration, or API-contract changes.
