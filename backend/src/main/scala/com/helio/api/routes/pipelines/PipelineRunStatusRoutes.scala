package com.helio.api.routes.pipelines

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.api.protocols.pipelines.RunStatusResponse
import com.helio.api.protocols.IdParsing
import com.helio.domain.model.{AuthenticatedUser, OutputId}
import com.helio.services.pipelines.PipelineRunService

import scala.concurrent.ExecutionContext

/** Run status + per-step/per-Output preview endpoints.
 *
 *  - `GET /api/pipelines/:id/runs/:runId` — cached run status / result
 *  - `GET /api/pipelines/:id/steps/:stepId/preview` — single-step preview tray
 *  - `POST /api/pipelines/:id/preview?outputId=` — per-Output dry run when `outputId` is
 *    present, ALL-Outputs dry run (uniform `{outputs: [...]}` envelope either way) when absent
 *    (HEL-906 cycle 10, P1.4's `preview_outputs(pipelineId, outputId?)` dependency); never
 *    mutates run state.
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
        },
        path("preview") {
          post {
            parameters("outputId".optional) { outputIdRaw =>
              ServiceResponse.run(runService.previewOutputs(pipelineId, outputIdRaw.map(OutputId(_)), user))(identity)
            }
          }
        }
      )
    }
}
