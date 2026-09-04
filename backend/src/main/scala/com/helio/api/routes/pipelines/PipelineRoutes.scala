package com.helio.api.routes.pipelines

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{CreatePipelineRequest, JsonProtocols, UpdatePipelineRequest}
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.api.protocols.pipelines.{CreatePipelineRootRequest, PipelineProposal, ValidateExpressionRequest}
import com.helio.domain.model.{AuthenticatedUser, PipelineRootId, PipelineStepId}
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
        // HEL-906 task 3.4: `stepId` absent means the pipeline's raw source (mirrors
        // `NodeRef.stepId = None`).
        path(PipelineIdSegment / "capabilities") { pipelineId =>
          get {
            parameter("stepId".optional) { stepId =>
              ServiceResponse.run(pipelineService.capabilitiesAtNode(pipelineId, stepId.map(PipelineStepId(_)), user))(identity)
            }
          }
        },
        // HEL-906 cycle 7: `stepId` absent means the pipeline's raw source, exactly like
        // `capabilities` above (same node-resolution machinery under the hood).
        path(PipelineIdSegment / "validate-expression") { pipelineId =>
          post {
            parameter("stepId".optional) { stepId =>
              entity(as[ValidateExpressionRequest]) { req =>
                ServiceResponse.run(pipelineService.validateExpression(pipelineId, stepId.map(PipelineStepId(_)), req.expression, user))(identity)
              }
            }
          }
        },
        // HEL-913 task 7.4: roots CRUD (R6 -- same element shape as `roots[]` at create time).
        // Registered BEFORE the bare PipelineIdSegment branch below for the same reason as
        // "analyze-proposal" above -- PipelineIdSegment / "roots" would otherwise be swallowed
        // by the unconstrained single-segment PipelineIdSegment matcher if ordering were reversed
        // (it is not, since this is nested one level deeper, but kept adjacent to the other
        // pipeline-scoped sub-routes for readability).
        path(PipelineIdSegment / "roots") { pipelineId =>
          post {
            entity(as[CreatePipelineRootRequest]) { req =>
              ServiceResponse.run(pipelineService.addRoot(pipelineId, req, user)) { root =>
                StatusCodes.Created -> root
              }
            }
          }
        },
        path(PipelineIdSegment / "roots" / Segment) { (pipelineId, rootIdStr) =>
          delete {
            ServiceResponse.run(pipelineService.removeRoot(pipelineId, PipelineRootId(rootIdStr), user))(identity)
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
