# HEL-116 — Propagate trace context into logs

**Linear:** https://linear.app/helioapp/issue/HEL-116/propagate-trace-context-into-logs
**Parent:** HEL-80 · **Milestone:** Observability · **Priority:** Low

## Description

Extract `X-Cloud-Trace-Context` from incoming requests, put the trace ID into
MDC so every log line during the request carries it. This lets you jump from a
Cloud Run request log straight to all app logs from that request.

## Context / constraints

- Cloud Run header format: `X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=TRACE_TRUE`.
  Extract just the `TRACE_ID` (the substring before the `/`).
- For Cloud Logging correlation the canonical MDC field is emitted as
  `logging.googleapis.com/trace` with value `projects/PROJECT_ID/traces/TRACE_ID`.
  Confirm what HEL-115's encoder setup expects and keep it consistent — the trace
  must actually show up as a searchable field in a `json`-format log line.
- Builds on HEL-115 (structured JSON logging, PR #255, merged): `logback.xml`
  selects `LogstashEncoder` in the `json` `LOG_FORMAT` branch; LogstashEncoder
  includes MDC entries by default. `pekko-slf4j` is on the classpath.
- This is a Pekko HTTP server. MDC is thread-local; Pekko dispatches across
  threads, so the trace ID must be captured at the request boundary and made
  available for the log lines that matter (notably the `onComplete` Failure
  error logs in `ApiRoutes`, which run on async EC threads). Root-cause the
  propagation approach (a directive that sets/clears MDC around request handling,
  or equivalent) rather than assuming a naive `MDC.put` survives async
  boundaries — verify with a probe (systematic-debugging law).
- Clean up MDC after the request to avoid leaking a trace ID onto a pooled
  thread's later requests.

## Acceptance criteria

- Incoming requests carrying `X-Cloud-Trace-Context` result in the trace ID
  appearing in `json`-format log lines emitted during that request, as a
  searchable field consistent with HEL-115's encoder / Cloud Logging conventions.
- Requests without the header behave exactly as before (no error, no stray MDC
  key leaked).
- MDC is cleaned up after each request so a pooled thread does not carry a stale
  trace ID into a later request.
- Approach is probe-verified to actually reach the log lines that matter (async
  callbacks included), not merely assumed.
