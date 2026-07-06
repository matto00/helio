package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain.AuthenticatedUser
import com.helio.services.DashboardProposalService

import scala.concurrent.ExecutionContextExecutor

/** `POST /api/dashboards/apply-proposal` (HEL-225).
 *
 *  Applies a reviewed dashboard proposal — the single write path shared by the
 *  MCP `apply_proposal` tool and the in-app Proposal Review UI. Validation +
 *  creation live in [[DashboardProposalService]], which composes the existing
 *  dashboard/panel services (no direct DB access, RLS + V41 enforced). */
final class DashboardProposalRoutes(
    proposalService: DashboardProposalService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("dashboards") {
      path("apply-proposal") {
        post {
          entity(as[DashboardProposal]) { proposal =>
            ServiceResponse.run(proposalService.apply(proposal, user)) { case (dashboard, panels) =>
              StatusCodes.Created -> DuplicateDashboardResponse(
                dashboard = DashboardResponse.fromDomain(dashboard),
                panels    = panels.map(p => PanelResponse.fromDomain(p))
              )
            }
          }
        }
      }
    }
}
