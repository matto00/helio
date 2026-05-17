package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.api.protocols.{IdParsing, RunStatusResponse}
import com.helio.domain.AuthenticatedUser
import com.helio.services.PipelineRunService

import scala.concurrent.ExecutionContext

/** Run status + per-step preview endpoints.
 *
 *  - `GET /api/pipelines/:id/runs/:runId` — cached run status / result
 *  - `GET /api/pipelines/:id/steps/:stepId/preview` — single-step preview tray
 */
final class PipelineRunStatusRoutes(runService: PipelineRunService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  import IdParsing.PipelineIdSegment

  val routes: Route =
    pathPrefix("pipelines" / PipelineIdSegment) { pipelineId =>
      concat(
        path("runs" / Segment) { runId =>
          get {
            // pipelineId is unused for cache lookup (cache key is the run id);
            // we keep it in the path for client-facing consistency.
            val _ = pipelineId
            runService.status(runId) match {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("Run not found: " + runId))
              case Some(cached) =>
                complete(
                  StatusCodes.OK,
                  RunStatusResponse(cached.runId, cached.status, cached.rows, cached.error, cached.rowCount)
                )
            }
          }
        },
        path("steps" / Segment / "preview") { stepId =>
          get {
            ServiceResponse.run(runService.previewStep(pipelineId, stepId, user))(identity)
          }
        }
      )
    }
}
