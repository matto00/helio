package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
// HEL-383: PipelineProposal isn't re-exported via the `com.helio.api` package
// object yet (HEL-379 added the protocol trait but no route consumed it until
// now) — import directly from its authoritative package.
import com.helio.api.protocols.PipelineProposal
import com.helio.domain.AuthenticatedUser
import com.helio.services.PipelineProposalService

import scala.concurrent.ExecutionContextExecutor

/** `POST /api/pipelines/apply-proposal` (HEL-383).
 *
 *  Applies a reviewed pipeline proposal — the atomic apply path for
 *  `PipelineProposal` (HEL-379). Validation + creation + rollback live in
 *  [[PipelineProposalService]], which composes the existing source/pipeline/
 *  run services (no direct DB access, RLS enforced). Mirrors
 *  `DashboardProposalRoutes`'s structure exactly. */
final class PipelineProposalRoutes(
    proposalService: PipelineProposalService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("pipelines") {
      path("apply-proposal") {
        post {
          entity(as[PipelineProposal]) { proposal =>
            ServiceResponse.run(proposalService.apply(proposal, user)) { response =>
              StatusCodes.Created -> response
            }
          }
        }
      }
    }
}
