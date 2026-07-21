## 1. Backend — probe the async propagation (systematic-debugging law)

- [x] 1.1 Add a temporary probe route/test that logs from an async `onComplete` callback while a request carrying `X-Cloud-Trace-Context` is in flight under `LOG_FORMAT=json`; observe whether the trace id reaches that emitted line.
- [x] 1.2 Record the probe result (which threads carry MDC, where capture must happen) to choose the propagation mechanism; remove the temporary probe route once the mechanism is settled.

### 2. Backend — trace extraction + MDC field

- [x] 2.1 Add `TraceContextDirective` in `com.helio.api` that parses `X-Cloud-Trace-Context`, extracts the trace id (substring before `/`, blank/absent treated as no-trace).
- [x] 2.2 Format the MDC value under key `logging.googleapis.com/trace`: `projects/$PROJECT_ID/traces/$TRACE_ID` when `GOOGLE_CLOUD_PROJECT` is set, else the bare trace id; read the project id once.
- [x] 2.3 Set the MDC key for the request and register cleanup that removes it on every exit path (success, rejection, failure) so no pooled thread leaks a stale trace.

### 3. Backend — async propagation + wiring

- [x] 3.1 Implement the probe-confirmed async mechanism (leading candidate: a request-scoped MDC-propagating `ExecutionContext` capturing MDC at route-evaluation time) so async `onComplete` error logs carry the trace.
- [x] 3.2 Wrap the route tree in `ApiRoutes.routes` with `withTraceContext` at the outermost boundary; confirm requests without the header behave unchanged.

### 4. Tests

- [x] 4.1 Directive unit test: trace id extracted from `TRACE/SPAN;o=1` yields `TRACE`; blank/absent header adds no MDC key.
- [x] 4.2 MDC value test: fully-qualified value when project id set, bare trace id when unset.
- [x] 4.3 Cleanup test: MDC key is absent after request handling (no leak across sequential requests on a reused thread).
- [x] 4.4 End-to-end test asserting a JSON-format log line emitted during a traced request (including an async failure-path log) carries the `logging.googleapis.com/trace` field.
- [x] 4.5 Run gates: `sbt test` (backend), then root `npm run lint`, `npm test`, `npm run format:check`, `npm run check:schemas`.
