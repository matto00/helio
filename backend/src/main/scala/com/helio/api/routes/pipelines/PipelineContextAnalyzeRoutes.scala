package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines.PipelineContextAnalyzeResponse
import com.helio.api.routes.ServiceResponse
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.pipelines.PipelineService
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route

import scala.concurrent.ExecutionContext

/** GET `/api/pipelines/context-analyze` (HEL-1625): every pipeline `GET /api/pipelines` returns for the caller, with
 *  the `steps` and `warnings` `GET /api/pipelines/:id/analyze` returns for it, in ONE response -- so a client
 *  grounding on the whole workspace (helio-mcp `get_workspace_context`) sends one request instead of one per pipeline.
 *
 *  MOUNT BEFORE [[PipelineRoutes]], beside [[PipelineContextDetailsRoutes]]: that class's unconstrained
 *  `PipelineIdSegment` GET would otherwise take `context-analyze` for a pipeline id. Additive only: no existing
 *  route's status, body or headers change. */
final class PipelineContextAnalyzeRoutes(
    pipelineService: PipelineService,
    user: AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    path("pipelines" / "context-analyze") {
      get {
        ServiceResponse.run(pipelineService.contextAnalyzeForOwner(user).map(_.map(PipelineContextAnalyzeResponse(_))))(identity)
      }
    }
}
