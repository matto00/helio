## Why

A live Cloud SQL connectivity incident (2026-08-19) exposed two compounding masking defects:
HikariCP's default `connectionTimeout` (30s) means a genuine DB outage hangs every request for
~30s before failing, and the resulting failure response carries no CORS headers, so the browser
reports a confusing "CORS Missing Allow Origin" error instead of a clean, fast 5xx. This is the
second occurrence of this exact masking pattern (see HEL-696).

## What Changes

- Set an explicit, short `connectionTimeout` on both HikariCP pools (app + privileged) so a DB
  outage fails fast instead of hanging ~30s per request.
- Register an explicit `ExceptionHandler`/`RejectionHandler` **inside** the `cors()` directive in
  `ApiRoutes.scala` so every response — success, curated error, or unhandled exception/rejection —
  reliably carries CORS headers and returns a clean, typed error body (reusing the existing
  `ErrorResponse` shape and the `error-response-safety` no-leak invariant) instead of Pekko's
  default plaintext response.
- **(Fold-in)** Extract the two handlers above out of `ApiRoutes.scala` (now 720 lines, past the
  ~400-line soft-split threshold) into a small companion object — a behavior-preserving refactor,
  no functional change.
- **(Fold-in)** Register a dedicated `RejectionHandler` for `CorsRejection` **outside** `cors()`
  (wrapping `cors(corsSettings) { ... }` itself), so a request with a disallowed/spoofed `Origin`
  header also gets a clean, quiet, curated response instead of Pekko's raw default — closing the
  one residual masking gap the initial round of this change left (documented as a non-blocking
  finding by both the evaluator and the final-gate skeptic).

## Capabilities

### New Capabilities
(none this round — `cors-error-handling` already exists from the first round of this change)

### Modified Capabilities
- `cors-error-handling`: adds a requirement that a disallowed-origin `CorsRejection` also receives
  a clean, curated response (no raw exception detail, no CORS headers — the origin is not allowed)
  instead of Pekko's raw default.
- `hikaricp-pool-config`: unchanged this round (already modified and merged in the first round;
  no further change here).

## Impact

- `backend/src/main/resources/application.conf` — unchanged this round.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — remove the two handlers (already added
  in the first round) in favor of importing them from the new companion object; wrap
  `cors(corsSettings) { ... }` with a new `handleRejections(...)` for `CorsRejection`.
- `backend/src/main/scala/com/helio/api/TopLevelErrorHandlers.scala` — **new file**: houses
  `topLevelExceptionHandler`, `topLevelRejectionHandler` (moved verbatim from `ApiRoutes.scala`),
  and the new `corsRejectionHandler`.
- No API contract change: existing `ErrorResponse` JSON shape is reused; only the presence of
  CORS headers, the speed of DB-outage failure, and the disallowed-origin response body change.

### Non-goals

- Frontend retry/resilience handling (HEL-602, explicitly out of scope).
- Changing HikariCP pool sizing (`maximumPoolSize`/`minimumIdle`/`idleTimeout`/`maxLifetime`) —
  those were already tuned in HEL-696/HEL-748 and are unaffected here.
