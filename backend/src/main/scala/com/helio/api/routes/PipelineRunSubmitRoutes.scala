package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.domain.AuthenticatedUser
import com.helio.services.PipelineRunService

import scala.concurrent.ExecutionContext

/** POST `/api/pipelines/:id/run[?dry=true]` — submit a (dry-)run.
 *
 *  Thin HTTP shell: dispatches to [[PipelineRunService.submit]] and
 *  translates the service's `ServiceError` channel via
 *  [[ServiceResponse]]. All run-lifecycle logic lives in the service. */
final class PipelineRunSubmitRoutes(runService: PipelineRunService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("pipelines" / PipelineIdSegment / "run") { pipelineId =>
      pathEndOrSingleSlash {
        post {
          parameter("dry".?) { dryParam =>
            val isDry = dryParam.contains("true")
            ServiceResponse.run(runService.submit(pipelineId, isDry, user)) { result =>
              StatusCodes.OK -> result
            }
          }
        }
      }
    }
}
