package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{CreatePipelineStepRequest, JsonProtocols, UpdatePipelineStepRequest}
import com.helio.api.protocols.IdParsing.{PipelineIdSegment, PipelineStepIdSegment}
import com.helio.domain.AuthenticatedUser
import com.helio.services.PipelineService

import scala.concurrent.ExecutionContext

/** Thin HTTP shell for `/api/pipelines/:id/steps` and `/api/pipeline-steps/:id`.
 *  All logic in [[PipelineService]]. */
class PipelineStepRoutes(pipelineService: PipelineService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route = concat(
    pathPrefix("pipelines" / PipelineIdSegment / "steps") { pipelineId =>
      pathEndOrSingleSlash {
        concat(
          get {
            ServiceResponse.run(pipelineService.listSteps(pipelineId, user))(identity)
          },
          post {
            entity(as[CreatePipelineStepRequest]) { req =>
              ServiceResponse.run(pipelineService.addStep(pipelineId, req, user)) { resp =>
                StatusCodes.Created -> resp
              }
            }
          }
        )
      }
    },
    pathPrefix("pipeline-steps" / PipelineStepIdSegment) { stepId =>
      pathEndOrSingleSlash {
        concat(
          patch {
            entity(as[UpdatePipelineStepRequest]) { req =>
              ServiceResponse.run(pipelineService.updateStep(stepId, req, user))(identity)
            }
          },
          delete {
            ServiceResponse.runNoContent(pipelineService.deleteStep(stepId, user))
          }
        )
      }
    }
  )
}
