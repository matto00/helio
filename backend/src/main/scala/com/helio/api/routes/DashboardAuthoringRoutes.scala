package com.helio.api.routes

import org.apache.pekko.http.scaladsl.marshalling.ToResponseMarshallable
import org.apache.pekko.http.scaladsl.model.{ContentType, HttpCharsets, HttpEntity, HttpResponse, MediaType, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.AuthoringConversationIdSegment
import com.helio.domain.AuthenticatedUser
import com.helio.services.{AuthoringError, AuthoringErrorKind, AuthoringTelemetry, DashboardAuthoringService}
import org.slf4j.MDC

import scala.concurrent.{ExecutionContextExecutor, Future}

/** `POST /api/authoring/dashboard` (HEL-392) — authors, validates, but never applies a
 *  `DashboardProposal` from a natural-language goal (single-shot, or continuing a persisted
 *  conversation when `conversationId` is present — HEL-397). Buffered by default; `?stream=true`
 *  returns an SSE response, built the same way [[PipelineRunStreamRoutes]] does
 *  (`HttpEntity.Chunked.fromData(sseContentType, byteSource)`).
 *
 *  `GET /api/authoring/conversations/:id` (HEL-397 design.md D7) rehydrates a conversation's
 *  visible thread after a reload — the display-only subset (`displayTurns`/`latestProposal`), never
 *  the server-internal `apiHistory`.
 *
 *  `POST /api/authoring/requests/:id/outcome` (HEL-401 design.md D4) is telemetry-only: it records
 *  an `accepted`/`rejected` outcome correlated to a prior successful call's `authoringRequestId` and
 *  never touches `apply-proposal`'s own persistence path.
 *
 *  All orchestration lives in [[DashboardAuthoringService]] — this is a thin HTTP shell.
 *
 *  `serviceOpt` is `None` when `ClaudeConfig.fromEnv()` failed (no `ANTHROPIC_API_KEY`) — `ApiRoutes`
 *  still mounts this route family unconditionally (task 4.2), and a request against either route
 *  completes `503` explicitly (mirrors [[PipelineRunStreamRoutes]]'s own `registry == null ->
 *  ServiceUnavailable` precedent) rather than `reject`-ing into a bare `404`, which would look like
 *  the path simply doesn't exist. */
final class DashboardAuthoringRoutes(serviceOpt: Option[DashboardAuthoringService], user: AuthenticatedUser)(implicit ec: ExecutionContextExecutor)
    extends JsonProtocols {

  private val sseContentType: ContentType =
    ContentType(MediaType.customWithOpenCharset("text", "event-stream"), HttpCharsets.`UTF-8`)

  private val ValidOutcomes: Set[String] = Set("accepted", "rejected")

  private def unavailable: Route =
    complete(StatusCodes.ServiceUnavailable, ErrorResponse("Dashboard authoring is not configured"))

  /** Bespoke completion helper for `AuthoringError`-carrying results (HEL-401 design.md D1) — NOT
   *  `ServiceResponse.run`, whose `completeError` is `private` and hardcodes the generic
   *  `ErrorResponse` for every `ServiceError` variant, with no way to thread an extra `kind` field
   *  through it. Reuses `ServiceResponse.statusCodeFor` (loosened to `private[routes]` for exactly
   *  this reuse) so the status-code mapping itself is never duplicated — only the response BODY
   *  shape diverges, and only for a `kind`-carrying failure; anything outside the ticket's four
   *  defined categories (e.g. a missing conversation `NotFound`) still renders the pre-existing bare
   *  `ErrorResponse(message)`, unchanged. */
  private def completeAuthoring[A](result: Future[Either[AuthoringError, A]])(success: A => ToResponseMarshallable): Route =
    onSuccess(result) {
      case Right(a) => complete(success(a))
      case Left(AuthoringError(Some(kind), err, _)) =>
        complete(ServiceResponse.statusCodeFor(err), AuthoringErrorResponse(AuthoringErrorKind.wireName(kind), err.message))
      case Left(AuthoringError(None, err, _)) =>
        complete(ServiceResponse.statusCodeFor(err), ErrorResponse(err.message))
    }

  val routes: Route =
    pathPrefix("authoring") {
      concat(
        pathPrefix("dashboard") {
          pathEndOrSingleSlash {
            post {
              serviceOpt.fold(unavailable) { service =>
                entity(as[DashboardAuthoringRequest]) { request =>
                  parameters("stream".as[Boolean].optional) { streamOpt =>
                    // HEL-401 design.md D3: captured HERE, synchronously, on the route-evaluation
                    // thread — `TraceContextDirective` has already set the trace id in the MDC by
                    // this point (it wraps the entire route tree in `ApiRoutes`). Threaded as an
                    // explicit value into the service rather than assumed ambient: the service's
                    // own `Future` chains run on a class-level `ec` captured once at `ApiRoutes`
                    // construction, never this per-request, trace-carrying one.
                    val mdcSnapshot = MDC.getCopyOfContextMap
                    if (streamOpt.contains(true)) {
                      val byteSource = service.authorStreaming(request, user, mdcSnapshot).map(AuthoringStreamEvent.toSseBytes)
                      complete(HttpResponse(entity = HttpEntity.Chunked.fromData(sseContentType, byteSource)))
                    } else {
                      completeAuthoring(service.author(request, user, mdcSnapshot))(identity)
                    }
                  }
                }
              }
            }
          }
        },
        path("conversations" / AuthoringConversationIdSegment) { id =>
          get {
            serviceOpt.fold(unavailable) { service =>
              ServiceResponse.run(service.getConversation(id, user))(identity)
            }
          }
        },
        // HEL-401 design.md D4 (tasks.md 3.1) — telemetry-only correlation endpoint, mounted
        // UNCONDITIONALLY (not gated on `serviceOpt`, unlike the two routes above): it never calls
        // into `DashboardAuthoringService` at all (no persistence, no lookup against a repository —
        // the id is an opaque correlation token, never resolved), so a missing `ANTHROPIC_API_KEY`
        // has no bearing on whether this route can do its one job (emit a log line).
        path("requests" / Segment / "outcome") { authoringRequestId =>
          post {
            entity(as[AuthoringOutcomeRequest]) { request =>
              if (ValidOutcomes.contains(request.outcome)) {
                val mdcSnapshot = MDC.getCopyOfContextMap
                AuthoringTelemetry.emitApplyOutcome(mdcSnapshot, authoringRequestId, request.outcome)
                complete(StatusCodes.NoContent)
              } else {
                complete(StatusCodes.BadRequest, ErrorResponse(s"Invalid outcome value: '${request.outcome}'. Valid values: accepted, rejected"))
              }
            }
          }
        }
      )
    }
}
