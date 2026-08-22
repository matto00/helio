package com.helio.api.routes.pipelines

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{CreatePipelineRequest, JsonProtocols, UpdatePipelineRequest}
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.api.protocols.pipelines.PipelineProposal
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.pipelines.PipelineService

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
              parameter("tag".optional) { tag =>
                onSuccess(pipelineService.listSummaries(user, tag))(summaries => complete(StatusCodes.OK, summaries))
              }
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
        // HEL-381: registered BEFORE the PipelineIdSegment branches below —
        // PipelineIdSegment is an unconstrained Segment matcher (design.md D5)
        // that would otherwise swallow the literal "analyze-proposal" segment
        // as a bogus pipeline id.
        path("analyze-proposal") {
          post {
            entity(as[PipelineProposal]) { proposal =>
              ServiceResponse.run(pipelineService.analyzeProposal(proposal, user))(identity)
            }
          }
        },
        path(PipelineIdSegment / "analyze") { pipelineId =>
          get {
            ServiceResponse.run(pipelineService.analyze(pipelineId, user))(identity)
          }
        },
        path(PipelineIdSegment) { pipelineId =>
          concat(
            get {
              ServiceResponse.run(pipelineService.findSummaryById(pipelineId, user))(identity)
            },
            patch {
              entity(as[UpdatePipelineRequest]) { req =>
                ServiceResponse.run(pipelineService.updateName(pipelineId, req, user))(identity)
              }
            },
            delete {
              ServiceResponse.runNoContent(pipelineService.delete(pipelineId, user))
            }
          )
        }
      )
    }
}
