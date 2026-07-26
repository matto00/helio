package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DashboardIdSegment
import com.helio.domain.AuthenticatedUser
import com.helio.services.DashboardContentsService

import scala.concurrent.ExecutionContextExecutor

/** `PUT /api/dashboards/:id/contents` (HEL-363) — atomic, all-or-nothing
 *  replace of an existing dashboard's panel set. Mirrors
 *  [[DashboardProposalRoutes]]'s thin-shell shape; validation + repository
 *  orchestration live in [[DashboardContentsService]]. */
final class DashboardContentsRoutes(
    contentsService: DashboardContentsService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("dashboards") {
      path(DashboardIdSegment / "contents") { dashboardId =>
        put {
          entity(as[ReplaceDashboardContentsRequest]) { request =>
            ServiceResponse.run(contentsService.replaceContents(dashboardId, request, user)) {
              case (dashboard, panels) =>
                StatusCodes.OK -> DuplicateDashboardResponse(
                  dashboard = DashboardResponse.fromDomain(dashboard),
                  panels    = panels.map(p => PanelResponse.fromDomain(p))
                )
            }
          }
        }
      }
    }
}
