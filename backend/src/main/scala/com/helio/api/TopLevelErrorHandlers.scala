package com.helio.api

import org.apache.pekko.http.cors.scaladsl.CorsRejection
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpResponse, StatusCodes}
import org.apache.pekko.http.scaladsl.server.{Directives, ExceptionHandler, RejectionHandler}
import org.slf4j.LoggerFactory
import spray.json._

/** HEL-750: top-level exception/rejection handling for `ApiRoutes.routes`, extracted
 *  into its own object (fold-in, design.md D5) once `ApiRoutes.scala` grew past
 *  CONTRIBUTING.md's ~400-line soft-split threshold as a direct result of adding
 *  these handlers. A plain `object`, not a `class`/`trait` mixed into `ApiRoutes`,
 *  since none of the three handlers below close over anything but this object's own
 *  logger, `ErrorResponse`, and Pekko/spray-json machinery -- no `ApiRoutes`
 *  constructor dependency needed, and a mixed-in trait's members would still count
 *  toward `ApiRoutes`'s effective review surface without giving the handlers an
 *  independently testable/reusable home. `ApiRoutes.routes` references
 *  `topLevelExceptionHandler`/`topLevelRejectionHandler`/`corsRejectionHandler` at
 *  their existing call sites. */
object TopLevelErrorHandlers extends Directives with JsonProtocols {

  private val log = LoggerFactory.getLogger(getClass)

  // HEL-750: no ExceptionHandler/RejectionHandler was registered anywhere in the
  // backend before this. Pekko's default handling for an unhandled exception or
  // rejection runs OUTSIDE the `cors(corsSettings) { ... }` scope in ApiRoutes (it's
  // applied by the server binding, wrapping the route that class exposes), so the
  // resulting failure response reached the client with no CORS headers at all --
  // surfacing to a browser as a confusing "CORS Missing Allow Origin" error instead
  // of a clean 5xx. Registering both handlers immediately inside `cors(corsSettings)`
  // in `ApiRoutes.routes` guarantees `cors()` always sees the final response and
  // attaches headers to it, regardless of how the request fails.

  /** Catches any exception that escapes route evaluation (e.g. a downstream
   *  connection-acquisition failure). Logs the full exception + stack trace
   *  server-side and completes with the same generic `ErrorResponse("Internal server
   *  error")` shape already used at `ApiRoutes.scala`'s existing catch sites (`GET
   *  /api/auth/me`, `PATCH /api/users/me/update`) -- never touches
   *  `ex.getMessage`/`getLocalizedMessage` in the response, so no raw exception/driver
   *  detail can leak into the body (`error-response-safety`).
   */
  val topLevelExceptionHandler: ExceptionHandler = ExceptionHandler { case ex: Throwable =>
    extractRequest { req =>
      log.error(s"Unhandled exception evaluating ${req.method.value} ${req.uri}", ex)
      complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
    }
  }

  /** Starts from Pekko's own `RejectionHandler.default` -- so every rejection Pekko
   *  already knows how to turn into a response (unmatched path, method not allowed,
   *  malformed content, etc.) keeps its existing status code AND its existing,
   *  specific message text (e.g. naming the missing/malformed field) -- and only
   *  remaps the final plain-text response body into the same `ErrorResponse` JSON
   *  shape via `mapRejectionResponse`, so CORS headers attach reliably and clients get
   *  a consistent JSON envelope instead of Pekko's default plain-text body. This
   *  leaves every more-specific rejection/completion decision elsewhere in the tree
   *  (e.g. `AuthDirectives.authenticate`'s 401, `requireCsrfHeader`'s 403) untouched:
   *  those call `complete(...)` directly and never produce a `Rejection`, so they
   *  never reach this handler at all.
   */
  val topLevelRejectionHandler: RejectionHandler =
    RejectionHandler.default.mapRejectionResponse {
      case res @ HttpResponse(_, _, HttpEntity.Strict(ContentTypes.`text/plain(UTF-8)`, data), _) =>
        res.withEntity(HttpEntity(ContentTypes.`application/json`, ErrorResponse(data.utf8String).toJson.compactPrint))
      case res => res
    }

  /** HEL-750 fold-in (design.md D6): `cors(corsSettings)` mints its own `CorsRejection`
   *  for a disallowed `Origin` *before* control reaches `topLevelExceptionHandler`/
   *  `topLevelRejectionHandler` registered inside it -- `cors()` is the outermost
   *  directive around those two, so a `CorsRejection` it raises itself can only be
   *  caught by a handler wrapping `cors()` from the OUTSIDE (see `ApiRoutes.routes`).
   *  Left unhandled, this rejection reaches Pekko's `Route.seal` fallback, which
   *  throws `RuntimeException("Unhandled rejection: ...")`, logged at `ERROR` with a
   *  full stack trace -- reproducing the exact masking bug this ticket set out to fix,
   *  for the one path (disallowed origin) round one's placement couldn't reach.
   *
   *  Completes with `403 Forbidden` (not `pekko-http-cors`'s own built-in
   *  `CorsDirectives.corsRejectionHandler`, which returns a bare
   *  `(StatusCodes.BadRequest, s"CORS: $causes")` string, not this project's
   *  `ErrorResponse` JSON envelope, and doesn't control log level) -- a disallowed
   *  origin is authorization-shaped (this caller isn't permitted), not a
   *  malformed-request one. `CorsRejection#cause.description` only echoes back the
   *  request's own `Origin`/method/header values, never driver/internal detail, so
   *  including it in the response body stays compliant with `error-response-safety`.
   *  Logged at `WARN` (not `ERROR`), no stack trace -- routine bot/scanner traffic,
   *  not an application fault. Deliberately does NOT attach CORS headers: the origin
   *  is genuinely not allowed. */
  val corsRejectionHandler: RejectionHandler =
    RejectionHandler.newBuilder().handle { case r: CorsRejection =>
      log.warn(s"CORS request rejected: ${r.cause.description}")
      complete(StatusCodes.Forbidden, ErrorResponse(s"CORS request rejected: ${r.cause.description}"))
    }.result()
}
