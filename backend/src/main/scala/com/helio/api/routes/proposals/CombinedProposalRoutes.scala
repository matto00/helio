package com.helio.api.routes.proposals

import com.helio.api.routes.{RunResponseMarshalling, ServiceResponse}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.proposals.{CombinedProposal, ProposalValidateResponse}
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.proposals.CombinedProposalService

import scala.concurrent.ExecutionContextExecutor

/** `POST /api/proposals/apply` (HEL-387).
 *
 *  Applies a combined pipeline+dashboard proposal atomically — a brand-new
 *  top-level `proposals` prefix (design.md D6), not nested under the
 *  `dashboards` or `pipelines` prefixes since it is neither exclusively.
 *  Validation, sentinel resolution, and rollback-on-dashboard-failure live in
 *  [[CombinedProposalService]], which composes the existing, unmodified
 *  `PipelineProposalService`/`DashboardProposalService` (no direct DB access,
 *  RLS enforced). Mirrors `PipelineProposalRoutes`/`DashboardProposalRoutes`'s
 *  structure exactly. */
final class CombinedProposalRoutes(
    combinedProposalService: CombinedProposalService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("proposals") {
      // HEL-1638 (D4): the propose-side dry run. No own rate-limit directive: the live source fetch it may issue is charged
      // once, inside `validate`, to the shared source-fetch budget; wrapping it in `sourceFetchRateLimitDirective` as well
      // would draw one request twice from the same bucket.
      path("validate") {
        post {
          entity(as[CombinedProposal]) { combined =>
            ServiceResponse.run(combinedProposalService.validate(combined, user).map(_.map(_ => ProposalValidateResponse(valid = true)))) {
              response => StatusCodes.OK -> response
            }
          }
        }
      } ~
      path("apply") {
        post {
          entity(as[CombinedProposal]) { combined =>
            ServiceResponse.run(combinedProposalService.apply(combined, user)) { response =>
              RunResponseMarshalling.chunkedJson(StatusCodes.Created, response)
            }
          }
        }
      }
    }
}
