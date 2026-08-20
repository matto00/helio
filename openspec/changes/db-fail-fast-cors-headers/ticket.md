# HEL-750: Backend: fail fast on DB connection failure + ensure error responses carry CORS headers

## Description

Surfaced by today's Cloud SQL connectivity incident: when the backend can't reach the database, requests hang for the full HikariCP `connectionTimeout` before failing, and the resulting failure response reaches the browser with no CORS headers at all — reported by a real user as a confusing "CORS Missing Allow Origin" error rather than a clean, fast 5xx. This is the second time this exact masking behavior has been documented (see HEL-696: prod privileged DB pool minimumIdle=0 causes connection storm 503s).

## Scope

1. Tune HikariCP `connectionTimeout` down from its current default/value to something short enough that a genuine DB outage fails fast rather than hanging ~30s per request.
2. Investigate why failure responses don't carry CORS headers — no custom `ExceptionHandler` is registered anywhere in the backend (confirmed via grep), so this is likely Pekko's default exception handling producing a response that bypasses the `cors()` directive's header-attachment logic (`ApiRoutes.scala:453`). Register an explicit `ExceptionHandler`/`RejectionHandler` inside the `cors()` wrapper (not outside it) so every response — success or failure — reliably carries the right CORS headers, and returns a clean, typed error body instead of Pekko's default.

Distinct from HEL-602 (frontend-only network-resilience/retry handling, explicitly out-of-scope for backend changes) — this ticket is backend-only.

Filed 2026-08-19 following a live production incident where this exact masking made root-causing the real issue (a Cloud SQL connectivity problem) needlessly confusing for the reporting user.

## Added scope (fold-in, 2026-08-20)

Two follow-up items surfaced by the evaluator/skeptic during review of the initial implementation were triaged and folded into this ticket's scope rather than filed as separate tickets:

3. **File-size split**: `ApiRoutes.scala` grew to 720 lines as a result of item 2 above (already past CONTRIBUTING.md's ~400-line soft-split threshold before this ticket). Extract the new `topLevelExceptionHandler`/`topLevelRejectionHandler` (and their doc comments) out of `ApiRoutes.scala` into a small companion object (e.g. `com.helio.api.TopLevelErrorHandlers`) — a behavior-preserving refactor, no functional change.
4. **Disallowed-origin CORS gap**: a request carrying a disallowed/spoofed `Origin` header still reproduces the original masking bug — `cors()` mints its own `CorsRejection` *outside* the `handleExceptions`/`handleRejections` scope registered inside `cors()` for item 2, so that one path still hits Pekko's raw default (`500`, plain-text, no CORS headers, plus `ERROR`-level stack-trace log spam). Register a dedicated `corsRejectionHandler` (Pekko's `CorsDirectives` support, or an equivalent explicit `CorsRejection` case) **outside** `cors()` so a disallowed-origin request also gets a clean, quiet, curated response instead of Pekko's default — this does not attach CORS headers (correctly — the origin is disallowed), it only replaces the raw/noisy failure mode with a curated one.

## Acceptance criteria

- A DB outage fails within a few seconds (HikariCP `connectionTimeout`), not ~30s.
- Every response from an allowed CORS origin — success, curated error, or an otherwise-unhandled exception/rejection — carries CORS headers and a clean `ErrorResponse` body.
- `ApiRoutes.scala`'s top-level exception/rejection handlers live in a separate companion object, with no behavior change.
- A request with a disallowed `Origin` header receives a clean, curated response (no raw exception detail, no `ERROR`-level stack-trace log spam) instead of Pekko's default — without CORS headers, since the origin is not allowed.

## Related tickets

- HEL-696: prod privileged DB pool minimumIdle=0 causes connection storm 503s (first occurrence of this masking behavior)
- HEL-602: frontend-only network-resilience/retry handling — explicitly out of scope here
