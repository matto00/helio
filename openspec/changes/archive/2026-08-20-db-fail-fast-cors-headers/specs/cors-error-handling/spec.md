## MODIFIED Requirements

### Requirement: Every response carries CORS headers, including unhandled exceptions and rejections

The backend SHALL register an `ExceptionHandler` and a `RejectionHandler` inside the `cors()`
directive that wraps the route tree, so that every HTTP response returned to a client — a
successful response, a curated error response, or a response produced by handling an otherwise
unhandled exception or rejection — carries the CORS headers configured for the request's origin.
An unhandled-exception response SHALL NOT include raw exception text, stack trace, or
driver/internal detail in its body (per `error-response-safety`); the full exception SHALL be
logged server-side.

The backend SHALL additionally register a `RejectionHandler` outside the `cors()` directive that
handles `CorsRejection` specifically, so that a request with a disallowed `Origin` header also
receives a clean, curated response — without CORS headers, since the origin is not allowed —
instead of Pekko's default unhandled-rejection response. This rejection SHALL be logged at a
level below `ERROR` and without a full stack trace, since a disallowed-origin request is expected
traffic (bot/scanner/misconfigured client), not an application fault.

#### Scenario: Unhandled exception response still carries CORS headers
- **WHEN** a request from an allowed CORS origin causes an unhandled exception during route
  evaluation (e.g. a downstream connection-acquisition failure)
- **THEN** the response includes an `Access-Control-Allow-Origin` header for that origin
- **AND** the response body is a generic, curated error message with no raw exception detail
- **AND** the full exception and stack trace are logged server-side

#### Scenario: Rejected request still carries CORS headers
- **WHEN** a request from an allowed CORS origin is rejected by route directives (e.g. no matching
  route, or a directive-level rejection not otherwise handled by a more specific route)
- **THEN** the response includes an `Access-Control-Allow-Origin` header for that origin
- **AND** the response body is a generic, curated error message consistent with the existing
  `ErrorResponse` shape

#### Scenario: Successful and existing curated-error responses are unaffected
- **WHEN** a request completes successfully, or a route completes with one of its own existing
  curated error responses (e.g. `StatusCodes.NotFound` with a specific message)
- **THEN** that response is returned unchanged, with CORS headers attached exactly as before this
  change

#### Scenario: Disallowed-origin request receives a clean, curated response

- **WHEN** a request carries an `Origin` header that does not match the configured allowlist
- **THEN** the response is a curated, typed error body (no raw exception/stack detail) with a
  `403 Forbidden` status
- **AND** the response does NOT include an `Access-Control-Allow-Origin` header, since the origin
  is not allowed
- **AND** the rejection is logged server-side at a level below `ERROR`, with no stack trace
