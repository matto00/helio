package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.{ContentType, HttpCharsets, HttpEntity, HttpResponse, MediaType, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.domain.AuthenticatedUser
import com.helio.services.PipelineRunService
import org.slf4j.LoggerFactory

import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

/** GET `/api/pipelines/:id/run-events` — SSE stream of run status events. */
final class PipelineRunStreamRoutes(runService: PipelineRunService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  private val log = LoggerFactory.getLogger(getClass)

  private val sseContentType: ContentType =
    ContentType(MediaType.customWithOpenCharset("text", "event-stream"), HttpCharsets.`UTF-8`)

  val routes: Route =
    pathPrefix("pipelines" / PipelineIdSegment / "run-events") { pipelineId =>
      pathEndOrSingleSlash {
        get {
          // HEL-279: sharing-aware — owner, editor, and viewer grantees can subscribe.
          onComplete(runService.pipelineExistsShared(pipelineId, user)) {
            case Failure(ex) =>
              // The access check should never fail for a valid request; if it
              // does, log the full exception server-side for diagnosis and
              // return a generic body so we do not leak internal detail to the
              // client (HEL-299).
              log.error(s"run-events access check failed for pipeline ${pipelineId.value}", ex)
              complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))
            case Success(false) =>
              complete(StatusCodes.NotFound, ErrorResponse("Pipeline not found: " + pipelineId.value))
            case Success(true) =>
              val registry = runService.eventRegistry
              if (registry == null)
                complete(StatusCodes.ServiceUnavailable, ErrorResponse("SSE registry not available"))
              else {
                val byteSource = registry.subscribe(pipelineId.value).map(RunStatusEvent.toSseBytes)
                complete(HttpResponse(entity = HttpEntity.Chunked.fromData(sseContentType, byteSource)))
              }
          }
        }
      }
    }
}
