## 1. Backend: HikariCP connectionTimeout

- [x] 1.1 Add `connectionTimeout = 5000` to `helio.db` in `backend/src/main/resources/application.conf`, with an inline comment explaining the fail-fast rationale (mirroring the existing tuning comments)
- [x] 1.2 Add `connectionTimeout = 5000` to `helio.db.privileged` in the same file

## 2. Backend: CORS-safe exception/rejection handling

- [x] 2.1 In `backend/src/main/scala/com/helio/api/ApiRoutes.scala`, define an `ExceptionHandler` that logs the full exception + stack trace via the existing logger and completes with `StatusCodes.InternalServerError -> ErrorResponse("Internal server error")`
- [x] 2.2 Define a `RejectionHandler` built from `RejectionHandler.default` that maps the terminal/unhandled case to a generic `ErrorResponse` body, preserving existing more-specific rejection handling elsewhere in the tree
- [x] 2.3 Wrap the existing route tree with `handleExceptions(...)` and `handleRejections(...)` immediately inside `cors(corsSettings) { ... }`, before `traceContext.withTraceContext`
- [x] 2.4 Verify no other `ExceptionHandler`/`RejectionHandler` registration exists elsewhere in the backend that this would conflict with or shadow (already confirmed via grep during planning — re-verify at implementation time)

## 3. Tests

- [x] 3.1 Backend test: a request that triggers an unhandled exception (e.g. simulate a DB connection failure) returns a response carrying the correct `Access-Control-Allow-Origin` header for an allowed origin
- [x] 3.2 Backend test: the unhandled-exception response body contains no raw exception/driver text and matches the generic `ErrorResponse("Internal server error")` shape
- [x] 3.3 Backend test: a request to an undefined route (rejection path) still carries CORS headers
- [x] 3.4 Backend test: existing successful and curated-error responses are unaffected (regression coverage for existing `ErrorResponse` call sites)
- [x] 3.5 Backend test (if feasible without a real outage): connection-acquisition against an unreachable/blackholed DB fails within a short bound rather than ~30s (or, if not feasibly testable in-process, document the manual/staging verification performed instead)

## 4. Backend: extract top-level error handlers (fold-in)

- [x] 4.1 Create `backend/src/main/scala/com/helio/api/TopLevelErrorHandlers.scala`: `object TopLevelErrorHandlers extends Directives with JsonProtocols` with its own `LoggerFactory` logger
- [x] 4.2 Move `topLevelExceptionHandler` and `topLevelRejectionHandler` (and their doc comments) verbatim from `ApiRoutes.scala` into the new object
- [x] 4.3 Update `ApiRoutes.scala` to reference `TopLevelErrorHandlers.topLevelExceptionHandler`/`topLevelRejectionHandler` at the existing call site; remove the now-duplicated definitions

## 5. Backend: disallowed-origin CorsRejection handling (fold-in)

- [x] 5.1 In `TopLevelErrorHandlers`, define `corsRejectionHandler: RejectionHandler` matching `org.apache.pekko.http.cors.scaladsl.CorsRejection`, completing with `StatusCodes.Forbidden -> ErrorResponse(s"CORS request rejected: ${r.cause.description}")`, logged at `WARN` with no stack trace
- [x] 5.2 In `ApiRoutes.scala`, wrap `cors(corsSettings) { ... }` with `handleRejections(TopLevelErrorHandlers.corsRejectionHandler) { ... }` from the outside

## 6. Tests

- [x] 6.1 Backend test: a request with a disallowed `Origin` header receives `403 Forbidden` with an `ErrorResponse` JSON body naming the rejected origin, and no `Access-Control-Allow-Origin` header
- [x] 6.2 Backend test: the disallowed-origin response contains no raw exception/stack detail
- [x] 6.3 Backend test: existing allowed-origin exception/rejection/success paths (task-group 3 coverage) are unaffected by the extraction and the new outer wrapper — full regression pass
- [x] 6.4 Manually verify (or automate) that the disallowed-origin path no longer logs at `ERROR` with a stack trace
