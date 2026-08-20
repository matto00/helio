## Context

`ApiRoutes.scala:451-456` builds `corsSettings` and wraps the entire route tree in
`cors(corsSettings) { ... }`. Pekko's `cors()` directive attaches CORS headers by inspecting the
route's own response; when no `ExceptionHandler`/`RejectionHandler` is registered *inside* that
scope, an unhandled exception or rejection is caught by Pekko's outer, default handling — which
runs **outside** `cors()`'s header-attachment logic, so the resulting failure response reaches the
client with no CORS headers. A browser then reports a misleading CORS error instead of surfacing
the real 5xx. Neither `ExceptionHandler` nor `RejectionHandler` is registered anywhere in the
backend today (confirmed by grep — the only other `ExceptionHandler` hit is an unrelated Scaladoc
comment in `PipelineService.scala`).

Separately, neither `helio.db` nor `helio.db.privileged` in `application.conf` sets
`connectionTimeout`, so both HikariCP pools fall back to HikariCP's built-in default (30 000 ms).
When Cloud SQL is unreachable, every request blocks for up to 30s waiting for a pooled connection
before HikariCP gives up and the request fails — exactly the ~30s hang the ticket describes.

## Added scope (fold-in, 2026-08-20)

The first round's live-verification step (evaluator + final-gate skeptic, independently) found a
**disallowed** `Origin` header still reproduces the original masking bug: `cors(settings)` raises
its own `CorsRejection` (confirmed via `pekko-http-cors` 1.1.0's `CorsDirectives.scala:96-133` in
the resolved jar) via `reject(...)` at the point `cors()` validates `Origin` — **before** control
reaches the `handleExceptions`/`handleRejections` pair registered *inside* `cors(corsSettings)`.
Since `cors()` is the outermost directive and nothing wraps it, this `CorsRejection` reaches
Pekko's `Route.seal` unhandled, which throws `RuntimeException("Unhandled rejection: ...")` —
logged at `ERROR` with a full stack trace, surfacing the same `500`/plain-text/no-CORS response
this ticket set out to eliminate. Correctly scoped per round one's own spec delta ("a request from
an allowed CORS origin"), but a real, live-reproducible residual gap worth closing.

Separately, `ApiRoutes.scala` grew from 671 to 720 lines as a direct result of round one, past
CONTRIBUTING.md's ~400-line soft-split threshold. Both items were triaged via the orchestrator's
`followup-triage` procedure (`ac_relevant=no`, `effort=small`, `overlap=high`) and answered
`fold-in` by the user.

## Goals / Non-Goals

**Goals:**
- A DB-outage failure surfaces within a few seconds, not ~30s.
- Every response the backend returns — success, curated 4xx/5xx, or an unhandled
  exception/rejection — carries the configured CORS headers.
- Unhandled-exception responses stay compliant with `error-response-safety`: no raw exception
  text/stack/driver detail in the body; full detail logged server-side.
- **(Added)** A request with a disallowed `Origin` header receives a clean, curated response (no
  raw exception detail, no `ERROR`-level stack-trace log spam) instead of Pekko's default — without
  CORS headers, since the origin is genuinely not allowed.
- **(Added)** The top-level exception/rejection handlers live in a dedicated, reusable location
  rather than growing `ApiRoutes.scala` further.

**Non-Goals:**
- Retuning `maximumPoolSize`/`minimumIdle`/`idleTimeout`/`maxLifetime` (already correct per
  HEL-696/HEL-748).
- Any frontend change (HEL-602 owns frontend retry/resilience, explicitly out of scope here).
- Building a fully general problem-detail/RFC-7807 error envelope — reuse the existing
  `ErrorResponse(message: String)` shape used throughout `ApiRoutes.scala`/route files today.

## Decisions

**D1. `connectionTimeout = 5000` (5s) on both pools.** Short enough to fail well within a typical
frontend request-timeout budget and to avoid a long hang once Cloud SQL is genuinely unreachable,
while staying comfortably above realistic pool-contention/connect-latency blips so a healthy but
momentarily busy pool doesn't spuriously fail acquisition. Applied identically to `helio.db` and
`helio.db.privileged` — both pools exhibited the same masking behavior in the HEL-696 incident and
there's no reason for them to diverge here.

**D2. Register `handleExceptions`/`handleRejections` immediately inside `cors(corsSettings) { ... }`,
wrapping the rest of the existing route tree**, rather than replacing `cors()` with a custom
directive or wrapping each sub-router individually. This is the minimal change that satisfies the
ticket's explicit instruction ("inside the `cors()` wrapper, not outside it") and guarantees
`cors()` always sees a response to attach headers to, regardless of how the request fails.
Alternative considered: a top-level `Http().bindAndHandle(..., exceptionHandler = ...)` — rejected
because Pekko HTTP applies the server-level handler *outside* the route tree (and therefore outside
`cors()`), which is exactly the mechanism causing today's bug.

**D3. The `ExceptionHandler` logs the full exception (with stack trace) via the existing
`log`/`LoggerFactory` logger already used in `ApiRoutes.scala`, and completes with
`StatusCodes.InternalServerError -> ErrorResponse("Internal server error")`** — reusing the exact
message already used at the existing `ErrorResponse("Internal server error")` call sites
(`ApiRoutes.scala:520,555`) so behavior is consistent whether an error is caught by a route's own
`Try`/`onComplete` handling or bubbles up to this top-level handler. Satisfies
`error-response-safety`'s "no raw exception detail in the body" invariant by construction — the
handler never touches `ex.getMessage`/`getLocalizedMessage` in the response.

**D4. The `RejectionHandler` starts from Pekko's `RejectionHandler.default` (via
`RejectionHandler.newBuilder().withFallback(RejectionHandler.default).result()` or equivalent) and
only maps the terminal/default case to the same `ErrorResponse` JSON body**, so existing per-route
rejection behavior (e.g. `authenticate`'s 401, validation rejections) is unaffected — the wrapper
adds CORS-header reliability, not new rejection semantics elsewhere in the tree that isn't
already independently handled by more specific directives.

**D5. Extract `topLevelExceptionHandler`/`topLevelRejectionHandler` (moved verbatim) plus the new
`corsRejectionHandler` (D6) into a new `object TopLevelErrorHandlers`** in a new file
`backend/src/main/scala/com/helio/api/TopLevelErrorHandlers.scala`, mixing in `Directives` (for
`complete`/`extractRequest`) and `JsonProtocols` (for `ErrorResponse`) with its own logger — a plain
object, not a class, since none of the three handlers close over anything but the logger,
`ErrorResponse`, and Pekko/`spray-json` machinery — no `ApiRoutes` constructor dependency needed.
`ApiRoutes.scala` references `TopLevelErrorHandlers.topLevelExceptionHandler` etc. at its existing
call site. Alternative considered: a `trait` mixed into `ApiRoutes` — rejected, since a mixed-in
trait's members still count toward the mixing class's effective review surface and reduces line
count without giving the handlers an independently testable/reusable home.

**D6. `corsRejectionHandler` wraps `cors(corsSettings) { ... }` from the outside** —
`handleRejections(TopLevelErrorHandlers.corsRejectionHandler) { cors(corsSettings) { ... } }` — the
only placement that can intercept a `CorsRejection`, since `cors()` itself raises it, ahead of every
directive nested inside it. Built via `RejectionHandler.newBuilder().handle { case r:
CorsRejection => ... }.result()`, matching a disallowed origin to `StatusCodes.Forbidden ->
ErrorResponse(s"CORS request rejected: ${r.cause.description}")` — `Cause#description` only echoes
back the request's own `Origin`/method/header, never driver/internal detail, so this stays
compliant with `error-response-safety`. Logged at `WARN` (not `ERROR`), no stack trace — routine
bot/scanner traffic, not an application fault, unlike D3's genuine unhandled exception. Alternative
considered: reuse `pekko-http-cors`'s own built-in `CorsDirectives.corsRejectionHandler`
(`CorsDirectives.scala:147-154` in the resolved 1.1.0 jar) — rejected: it completes with a bare
`(StatusCodes.BadRequest, s"CORS: $causes")` string, not this project's `ErrorResponse` JSON
envelope, and doesn't control log level. `403` (not the library's `400`) because a disallowed
origin is authorization-shaped (this caller isn't permitted), not a malformed-request one.

## Risks / Trade-offs

- [5s may still be too slow for some UX budgets] → Deferred: this is a materially better default
  than 30s and matches the ticket's own bound ("something short enough"); a future ticket can
  retune further with real latency data if needed.
- [A too-short `connectionTimeout` could cause false failures under legitimate burst load] →
  5000 ms sits well above HikariCP's own typical connection-acquisition latency under the
  existing `maximumPoolSize=5`/`minimumIdle=2` tuning; no pool-sizing change accompanies this, so
  contention characteristics are unchanged from today, only the failure-detection latency.
- [A blanket top-level `ExceptionHandler` could mask a route-specific handler that intentionally
  wants Pekko's default behavior] → Grep confirmed no existing `ExceptionHandler`/`RejectionHandler`
  registration anywhere in the backend, so there is nothing to conflict with or shadow.
- **(Added)** [Wrapping `cors(corsSettings)` with an additional outer `handleRejections(...)`] →
  The wrapper only matches `CorsRejection`; every other rejection/exception still flows through
  `cors()` into the unchanged, already-tested D2–D4 pair. No allowed-origin test changes behavior.
- **(Added)** [Reusing `error-response-safety`'s no-leak invariant for `CorsRejection.Cause#description`]
  → Verified the field only echoes the request's own `Origin`/method/header values back (see
  `CorsRejection.scala` in the resolved jar) — never a driver/DB/internal-exception message — so
  including it in the response body does not violate the invariant.

## Planner Notes

- Chose `cors-error-handling` as a **new** capability rather than folding into
  `error-response-safety`, because the latter's existing requirements are about *content*
  (never leak exception detail) while this change is about *header delivery* (CORS headers present
  on every response) — a genuinely distinct, independently-testable invariant.
- `hikaricp-pool-config` is modified (not replaced) — the existing requirements' pool-sizing
  numbers are unchanged; only `connectionTimeout` is added to each requirement's description.
- **(Added)** The disallowed-origin `corsRejectionHandler` (D6) is scoped to `cors-error-handling`
  (a `MODIFIED Requirements` delta this round) rather than a new capability — it is the same
  "every response carries appropriate CORS-aware treatment" invariant the first round established,
  just closing the one case (`CorsRejection` itself) that round's placement (deliberately *inside*
  `cors()`, per the ticket's own instruction) could not reach.
