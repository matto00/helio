package com.helio.api.routes.pipelines

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{CreatePipelineStepRequest, JsonProtocols, ReorderPipelineStepsRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.IdParsing.{PipelineIdSegment, PipelineStepIdSegment}
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.pipelines.PipelineService

import scala.concurrent.ExecutionContext

/** Thin HTTP shell for `/api/pipelines/:id/steps` and `/api/pipeline-steps/:id`.
 *  All logic in [[PipelineService]]. */
class PipelineStepRoutes(pipelineService: PipelineService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route = concat(
    pathPrefix("pipelines" / PipelineIdSegment / "steps") { pipelineId =>
      concat(
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
        },
        // HEL-407: PUT /api/pipelines/:id/steps/order — atomic batch reorder.
        path("order") {
          put {
            entity(as[ReorderPipelineStepsRequest]) { req =>
              ServiceResponse.run(pipelineService.reorderSteps(pipelineId, req, user))(identity)
            }
          }
        }
      )
    },
    pathPrefix("pipeline-steps" / PipelineStepIdSegment) { stepId =>
      concat(
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
        },
        // HEL-412: POST /api/pipeline-steps/:id/duplicate — clone kind+config+enabled,
        // inserted directly after the original.
        path("duplicate") {
          post {
            ServiceResponse.run(pipelineService.duplicateStep(stepId, user)) { resp =>
              StatusCodes.Created -> resp
            }
          }
        }
      )
    }
  )
}
