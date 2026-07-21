## Context

HEL-115 (PR #255) wired `logback.xml` so the `json` `LOG_FORMAT` branch uses `net.logstash.logback.encoder.
LogstashEncoder`, which serializes every SLF4J MDC entry as a top-level JSON field. `pekko-slf4j` is on the
classpath. Today nothing populates the MDC, so JSON logs carry no request identity. `ApiRoutes.scala` composes the
whole route tree inside `cors(corsSettings) { health.routes ~ pathPrefix("api") { ... } }` and logs request-scoped
errors from asynchronous `onComplete { case Failure(ex) => log.error(...) }` branches (e.g. `GET /api/auth/me`,
`PATCH /api/users/me/update`) using the class-level implicit `ec = system.executionContext`. Cloud Run tags each
request with `X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=TRACE_TRUE`.

## Goals / Non-Goals

**Goals:**
- Capture the trace id at the request boundary and expose it on log lines emitted during that request, including the
  async `onComplete` error logs, as a Cloud Logging-searchable field.
- Guarantee cleanup so a pooled worker thread never leaks a stale trace onto a later request.
- Root-cause the async-propagation mechanism with a probe, per `.concertino/laws/systematic-debugging.md`.

**Non-Goals:**
- Span/parent propagation, sampling, OpenTelemetry, or any distributed-tracing backend.
- Changes to the HEL-115 encoder, `LOG_FORMAT` selection, or plain-text format.

## Decisions

**D1 — A request-boundary directive owns extract + set + guaranteed cleanup.** Add a `TraceContextDirective`
(package `com.helio.api`, sibling of `AuthDirectives`/`AclDirective`) exposing e.g. `withTraceContext { inner }`, and
wrap the route tree in `ApiRoutes.routes` at the outermost point (inside/around `cors`). It reads the header, derives
the trace id (`value.takeWhile(_ != '/')`, guarding blank/absent), formats the MDC value (see D2), `MDC.put`s it, and
registers cleanup that removes the key on **every** exit path. Cleanup uses `mapResponse`/`andThen` plus a
`try/finally` so a thrown or rejected request still clears the key. Alternative rejected: `MDC.put` scattered at call
sites — violates the single-boundary principle and is impossible to clean up reliably.

**D2 — Emit under the Cloud Logging canonical key.** MDC key `logging.googleapis.com/trace`; value
`projects/$PROJECT_ID/traces/$TRACE_ID` when a project id is configured (read once from `GOOGLE_CLOUD_PROJECT`, the
standard Cloud Run env var), else the bare trace id so dev/local (`LOG_FORMAT=json`) still shows it. LogstashEncoder
emits the key verbatim, so no encoder change is needed. Alternative rejected: a short key like `trace` — loses the
automatic Cloud Logging request-to-log correlation that the canonical key unlocks.

**D3 — Async propagation is probe-driven, not assumed.** The class-level `ec` used by the `onComplete` error logs
dispatches those callbacks on dispatcher threads, and the callback is typically submitted *when the upstream (DB)
future completes* — on a repository thread whose MDC is empty. So a naive `MDC.put` in the directive, and even an
MDC-propagating EC that captures at `execute`-time, can miss these logs (capture-timing pitfall). The executor MUST
build a probe first: a temporary/test route that logs from an async `onComplete` callback while a traced request is
in flight under `LOG_FORMAT=json`, and assert the trace id appears on that emitted line. The mechanism is chosen to
pass the probe. Leading candidate: a request-scoped `MdcPropagatingExecutionContext` provided by the directive that
captures the MDC map at route-evaluation time (when the trace is present) and restores+clears it around each
callback, wired into the boundary so request-scoped async logs inherit it. If the probe shows the shared class-level
`ec` cannot carry the context to DB-completed callbacks without touching those call sites, the executor selects the
least-invasive mechanism that the probe confirms (e.g. a boundary-scoped EC, or restoring MDC in the response
continuation) and documents it. Synchronous logs are covered by D1 regardless.

**D4 — Verify against a real JSON line.** Verification (and the skeptic) confirms the field on an actual
`LOG_FORMAT=json` log line, per `.concertino/laws/verification-before-completion.md`, not by reading code.

## Risks / Trade-offs

- Capture-timing pitfall (D3): async callbacks submitted on empty-MDC repository threads → trace lost. Mitigation:
  mandatory probe before any completion claim; mechanism chosen to pass it.
- MDC leak onto pooled threads → wrong trace on a later request. Mitigation: unconditional cleanup on every exit path
  (D1), plus a spec scenario asserting the second request is clean.
- Over-scoping into full async-context propagation. Mitigation: request-scoped, trace-id-only; synchronous coverage
  is the floor, async error logs the target; escalate if reliable async coverage proves disproportionately invasive.
- Malformed/oversized header value. Mitigation: take only the pre-`/` segment; treat blank as absent (no key added).

## Planner Notes

Self-approved (no escalation): no new runtime dependencies (slf4j/logstash/pekko-slf4j already present); one optional
env var (`GOOGLE_CLOUD_PROJECT`) with a safe bare-id fallback; no API-contract, schema, or frontend impact. The exact
async mechanism is intentionally left to the executor's probe rather than pinned here, because the correct choice
depends on observed runtime behavior the systematic-debugging law requires be measured, not guessed.
