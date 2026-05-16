package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.{ContentType, HttpCharsets, HttpEntity, HttpResponse, MediaType, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.services.PipelineRunService

import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

/** GET `/api/pipelines/:id/run-events` — SSE stream of run status events. */
final class PipelineRunStreamRoutes(runService: PipelineRunService)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  private val sseContentType: ContentType =
    ContentType(MediaType.customWithOpenCharset("text", "event-stream"), HttpCharsets.`UTF-8`)

  val routes: Route =
    pathPrefix("pipelines" / PipelineIdSegment / "run-events") { pipelineId =>
      pathEndOrSingleSlash {
        get {
          onComplete(runService.pipelineExists(pipelineId)) {
            case Failure(ex) =>
              complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
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
