package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{CreatePipelineStepRequest, JsonProtocols, UpdatePipelineStepRequest}
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.services.PipelineService

import scala.concurrent.ExecutionContext

/** Thin HTTP shell for `/api/pipelines/:id/steps` and `/api/pipeline-steps/:id`.
 *  All logic in [[PipelineService]]. */
class PipelineStepRoutes(pipelineService: PipelineService)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route = concat(
    pathPrefix("pipelines" / PipelineIdSegment / "steps") { pipelineId =>
      pathEndOrSingleSlash {
        concat(
          get {
            ServiceResponse.run(pipelineService.listSteps(pipelineId))(identity)
          },
          post {
            entity(as[CreatePipelineStepRequest]) { req =>
              ServiceResponse.run(pipelineService.addStep(pipelineId, req)) { resp =>
                StatusCodes.Created -> resp
              }
            }
          }
        )
      }
    },
    pathPrefix("pipeline-steps" / Segment) { stepId =>
      pathEndOrSingleSlash {
        concat(
          patch {
            entity(as[UpdatePipelineStepRequest]) { req =>
              ServiceResponse.run(pipelineService.updateStep(stepId, req))(identity)
            }
          },
          delete {
            ServiceResponse.runNoContent(pipelineService.deleteStep(stepId))
          }
        )
      }
    }
  )
}
