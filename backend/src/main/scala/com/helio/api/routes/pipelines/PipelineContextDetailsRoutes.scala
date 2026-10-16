package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines.{PipelineContextDetailsItem, PipelineContextDetailsResponse}
import com.helio.api.routes.ServiceResponse
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.ServiceError
import com.helio.services.pipelines.{PipelineRunService, PipelineService}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route

import scala.concurrent.{ExecutionContext, Future}

/** GET `/api/pipelines/context-details` (HEL-1619): every pipeline `GET /api/pipelines` returns for the
 *  caller, with its steps and latest-run assertion summary, in ONE response -- so a client grounding on
 *  the whole workspace (helio-mcp `get_workspace_context`) sends one request instead of two per pipeline.
 *
 *  MOUNT BEFORE [[PipelineRoutes]]: that class's unconstrained `PipelineIdSegment` GET would otherwise
 *  take `context-details` for a pipeline id (same reason as its `analyze-proposal` ordering note).
 *  Additive only: no existing route's status, body or headers change. */
final class PipelineContextDetailsRoutes(
    pipelineService: PipelineService,
    runService: PipelineRunService,
    user: AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    path("pipelines" / "context-details") {
      get {
        ServiceResponse.run(response())(identity)
      }
    }

  private def response(): Future[Either[ServiceError, PipelineContextDetailsResponse]] =
    pipelineService.contextStepsForOwner(user).flatMap {
      case Left(e) => Future.successful(Left(e))
      case Right(stepsByPipeline) =>
        runService.latestAssertionsFor(stepsByPipeline.map(_._1).toSet).map { assertions =>
          Right(PipelineContextDetailsResponse(stepsByPipeline.map { case (id, steps) =>
            PipelineContextDetailsItem(id.value, steps, assertions.get(id))
          }))
        }
    }
}
