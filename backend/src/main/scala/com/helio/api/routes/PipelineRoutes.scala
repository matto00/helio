package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{CreatePipelineRequest, JsonProtocols, UpdatePipelineRequest}
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.domain.AuthenticatedUser
import com.helio.services.PipelineService

import scala.concurrent.ExecutionContext

/** Thin HTTP shell for `/api/pipelines`. All logic in [[PipelineService]]. */
class PipelineRoutes(
    pipelineService: PipelineService,
    user:            AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("pipelines") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              onSuccess(pipelineService.listSummaries())(summaries => complete(StatusCodes.OK, summaries))
            },
            post {
              entity(as[CreatePipelineRequest]) { req =>
                ServiceResponse.run(pipelineService.create(req, user)) { summary =>
                  StatusCodes.Created -> summary
                }
              }
            }
          )
        },
        path(PipelineIdSegment / "analyze") { pipelineId =>
          get {
            ServiceResponse.run(pipelineService.analyze(pipelineId, user))(identity)
          }
        },
        path(PipelineIdSegment) { pipelineId =>
          concat(
            get {
              ServiceResponse.run(pipelineService.findSummaryById(pipelineId))(identity)
            },
            patch {
              entity(as[UpdatePipelineRequest]) { req =>
                ServiceResponse.run(pipelineService.updateName(pipelineId, req))(identity)
              }
            },
            delete {
              ServiceResponse.runNoContent(pipelineService.delete(pipelineId))
            }
          )
        }
      )
    }
}
