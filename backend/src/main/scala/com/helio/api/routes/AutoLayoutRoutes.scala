package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DashboardIdSegment
import com.helio.domain.AuthenticatedUser
import com.helio.services.AutoLayoutService

import scala.concurrent.ExecutionContextExecutor

/** `POST /api/dashboards/:id/auto-layout` (HEL-367) — packs
 *  `{panelId, w, h}` sizes into non-overlapping `{x,y,w,h}` positions and
 *  persists them. Mirrors [[DashboardContentsRoutes]]'s thin-shell shape;
 *  validation + packing + persistence live in [[AutoLayoutService]]. */
final class AutoLayoutRoutes(
    autoLayoutService: AutoLayoutService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("dashboards") {
      path(DashboardIdSegment / "auto-layout") { dashboardId =>
        post {
          entity(as[AutoLayoutRequest]) { request =>
            ServiceResponse.run(autoLayoutService.autoLayout(dashboardId, request, user)) { dashboard =>
              StatusCodes.OK -> DashboardResponse.fromDomain(dashboard)
            }
          }
        }
      }
    }
}
