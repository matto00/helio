package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.{ContentType, HttpCharsets, HttpEntity, HttpResponse, MediaType, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.AuthoringConversationIdSegment
import com.helio.domain.AuthenticatedUser
import com.helio.services.DashboardAuthoringService

import scala.concurrent.ExecutionContext

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
 *  All orchestration lives in [[DashboardAuthoringService]] — this is a thin HTTP shell.
 *
 *  `serviceOpt` is `None` when `ClaudeConfig.fromEnv()` failed (no `ANTHROPIC_API_KEY`) — `ApiRoutes`
 *  still mounts this route family unconditionally (task 4.2), and a request against either route
 *  completes `503` explicitly (mirrors [[PipelineRunStreamRoutes]]'s own `registry == null ->
 *  ServiceUnavailable` precedent) rather than `reject`-ing into a bare `404`, which would look like
 *  the path simply doesn't exist. */
final class DashboardAuthoringRoutes(serviceOpt: Option[DashboardAuthoringService], user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  private val sseContentType: ContentType =
    ContentType(MediaType.customWithOpenCharset("text", "event-stream"), HttpCharsets.`UTF-8`)

  private def unavailable: Route =
    complete(StatusCodes.ServiceUnavailable, ErrorResponse("Dashboard authoring is not configured"))

  val routes: Route =
    pathPrefix("authoring") {
      concat(
        pathPrefix("dashboard") {
          pathEndOrSingleSlash {
            post {
              serviceOpt.fold(unavailable) { service =>
                entity(as[DashboardAuthoringRequest]) { request =>
                  parameters("stream".as[Boolean].optional) { streamOpt =>
                    if (streamOpt.contains(true)) {
                      val byteSource = service.authorStreaming(request, user).map(AuthoringStreamEvent.toSseBytes)
                      complete(HttpResponse(entity = HttpEntity.Chunked.fromData(sseContentType, byteSource)))
                    } else {
                      ServiceResponse.run(service.author(request, user))(identity)
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
        }
      )
    }
}
