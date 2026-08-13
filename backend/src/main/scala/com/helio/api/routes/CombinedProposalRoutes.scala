package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.api.protocols.CombinedProposal
import com.helio.domain.AuthenticatedUser
import com.helio.services.CombinedProposalService

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
      path("apply") {
        post {
          entity(as[CombinedProposal]) { combined =>
            ServiceResponse.run(combinedProposalService.apply(combined, user)) { response =>
              StatusCodes.Created -> response
            }
          }
        }
      }
    }
}
