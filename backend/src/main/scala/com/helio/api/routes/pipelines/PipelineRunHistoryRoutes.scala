package com.helio.api.routes.pipelines

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.pipelines.PipelineRunService

import scala.concurrent.ExecutionContext

/** GET `/api/pipelines/:id/run-history` — persisted run history list. */
final class PipelineRunHistoryRoutes(runService: PipelineRunService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("pipelines" / PipelineIdSegment / "run-history") { pipelineId =>
      pathEndOrSingleSlash {
        get {
          ServiceResponse.run(runService.history(pipelineId, user))(identity)
        }
      }
    }
}
